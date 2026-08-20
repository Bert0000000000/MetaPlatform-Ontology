// supabase/functions/saml-metadata/index.ts
// PRD: docs/active/prd/auth-jwt-rls.md §6.1
// Batch: MP-V6.1-SAML-SSO-01
// Edge Function: SAML IdP metadata 解析 + SP metadata 生成
//
// 路由:
//   GET  /functions/v1/saml-metadata?tenant_id=<uuid>      返回 SP metadata XML
//   POST /functions/v1/saml-metadata?tenant_id=<uuid>      上传 IdP metadata XML + 解析

// @ts-nocheck — Deno runtime
import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.0";
import { verifyAuth, AuthError, authErrorResponse } from "../_template-auth/index.ts";

const SP_BASE = Deno.env.get("SP_BASE_URL") ?? "https://mp-platform.example.com";

interface IdpMetadata {
  entityId: string;
  ssoUrl: string;
  sloUrl: string | null;
  certificate: string;
  nameIdFormat: string;
}

/**
 * Parse IdP metadata XML
 * Extracts: entityID, SingleSignOnService Location, SingleLogoutService Location, X509Certificate, NameIDFormat
 */
function parseIdpMetadata(xml: string): IdpMetadata {
  const extract = (tag: string, required = true): string => {
    const match = xml.match(new RegExp(`<${tag}[^>]*>([^<]+)<\/${tag}>`, "i"));
    if (!match && required) {
      throw new Error(`Missing required field: ${tag}`);
    }
    return match ? match[1].trim() : "";
  };

  return {
    entityId: extract("md:EntityID"),
    ssoUrl: extract("md:SingleSignOnService", false) || extract("SingleSignOnService"),
    sloUrl: extract("md:SingleLogoutService", false) || extract("SingleLogoutService"),
    certificate: extract("md:X509Certificate"),
    nameIdFormat: extract("md:NameIDFormat", false),
  };
}

/**
 * Generate SP metadata XML (返给 IdP, IdP 用来信任 SP)
 */
function generateSpMetadata(entityId: string, acsUrl: string): string {
  return `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata"
                  entityID="${entityId}">
  <SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true"
                   protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</NameIDFormat>
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                              Location="${acsUrl}"
                              index="0" isDefault="true"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
}

serve(async (req) => {
  const url = new URL(req.url);
  const tenantId = url.searchParams.get("tenant_id");
  if (!tenantId) {
    return new Response(JSON.stringify({ error: "Missing tenant_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const auth = await verifyAuth(req);
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );

    // GET: 返回 SP metadata (供 IdP 配置)
    if (req.method === "GET") {
      const acsUrl = `${SP_BASE}/functions/v1/saml-assertion?tenant_id=${tenantId}`;
      const entityId = `${SP_BASE}/saml/${tenantId}`;
      const xml = generateSpMetadata(entityId, acsUrl);
      return new Response(xml, {
        status: 200,
        headers: { "Content-Type": "application/xml" },
      });
    }

    // POST: 上传 IdP metadata XML 解析 + 存储
    if (req.method === "POST") {
      if (auth.role !== "admin" && auth.role !== "owner") {
        throw new AuthError("INSUFFICIENT_ROLE", "Only admin/owner can configure SSO", 403);
      }

      const body = await req.json() as { idp_metadata_xml: string };
      if (!body.idp_metadata_xml) {
        return new Response(JSON.stringify({ error: "Missing idp_metadata_xml" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 解析
      const idp = parseIdpMetadata(body.idp_metadata_xml);

      // 存到 DB
      const { error } = await supabase.from("tenant_sso_configs").upsert({
        tenant_id: tenantId,
        enabled: true,
        provider: "generic-saml",
        entity_id: `${SP_BASE}/saml/${tenantId}`,
        sso_url: `${SP_BASE}/functions/v1/saml-assertion?tenant_id=${tenantId}`,
        idp_metadata_xml: body.idp_metadata_xml,
        idp_entity_id: idp.entityId,
        idp_sso_url: idp.ssoUrl,
        idp_certificate: idp.certificate,
        claim_mappings: { email: "email", role: "role", tenant_id: "tenant_id" },
      }, { onConflict: "tenant_id,provider" });

      if (error) throw new Error(`DB error: ${error.message}`);

      return new Response(JSON.stringify({
        tenant_id: tenantId,
        entity_id: idp.entityId,
        sso_url: idp.ssoUrl,
        slo_url: idp.sloUrl,
        name_id_format: idp.nameIdFormat,
        message: "IdP metadata parsed and saved",
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    if (err instanceof AuthError) return authErrorResponse(err);
    const message = err instanceof Error ? err.message : String(err);
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
});