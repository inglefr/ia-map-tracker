// Worker Cloudflare — relais sécurisé entre la page web et GitHub Actions.
// La clé GitHub (GITHUB_TOKEN) reste ici, côté serveur, jamais visible du navigateur.
//
// Variables d'environnement à configurer dans le dashboard Cloudflare (Settings > Variables) :
//   GITHUB_TOKEN  (secret) — fine-grained PAT, droit "Actions: Read and write" sur ce repo uniquement
//   SHARED_KEY    (secret) — clé simple choisie par toi, pour éviter les déclenchements anonymes
//
// Appel attendu depuis la page : GET https://<ton-worker>.workers.dev/?scope=level1&key=...

const OWNER = "inglefr";
const REPO = "ia-map-tracker";
const WORKFLOW_FILE = "update.yml";

const ALLOWED_SCOPES = ["level1", "level2", "all"];

function corsHeaders(origin) {
  return {
    "Access-Control-Allow-Origin": origin || "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin");

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders(origin) });
    }

    const url = new URL(request.url);
    const scope = url.searchParams.get("scope") || "all";
    const key = url.searchParams.get("key") || "";

    if (key !== env.SHARED_KEY) {
      return new Response(JSON.stringify({ ok: false, error: "Clé invalide" }), {
        status: 401,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    if (!ALLOWED_SCOPES.includes(scope)) {
      return new Response(JSON.stringify({ ok: false, error: "Scope invalide" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    const ghRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/actions/workflows/${WORKFLOW_FILE}/dispatches`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.GITHUB_TOKEN}`,
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          "User-Agent": "ia-map-tracker-worker",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main", inputs: { scope } }),
      }
    );

    if (ghRes.status === 204) {
      return new Response(JSON.stringify({ ok: true, scope }), {
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      });
    }

    const errorText = await ghRes.text();
    return new Response(
      JSON.stringify({ ok: false, error: `GitHub a répondu ${ghRes.status}`, details: errorText }),
      {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders(origin) },
      }
    );
  },
};
