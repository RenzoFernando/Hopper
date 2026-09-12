const apiToken = String(process.env.CLOUDFLARE_API_TOKEN || "").trim();
const accountId = String(process.env.CLOUDFLARE_ACCOUNT_ID || "").trim();
const projectName = String(process.env.HOPPER_PAGES_PROJECT || "hopper-transfer").trim();
const productionBranch = String(process.env.HOPPER_PRODUCTION_BRANCH || "master").trim();

if (!apiToken) throw new Error("Falta CLOUDFLARE_API_TOKEN.");
if (!accountId) throw new Error("Falta CLOUDFLARE_ACCOUNT_ID.");
if (!projectName) throw new Error("Falta el nombre del proyecto de Cloudflare Pages.");
if (!productionBranch) throw new Error("Falta la rama de producción de Cloudflare Pages.");

const projectPath =
  `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}` +
  `/pages/projects/${encodeURIComponent(projectName)}`;

async function cloudflareRequest(method, body) {
  const response = await fetch(projectPath, {
    method,
    headers: {
      Authorization: `Bearer ${apiToken}`,
      "Content-Type": "application/json"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });

  let payload;
  try {
    payload = await response.json();
  } catch {
    throw new Error(`Cloudflare respondió HTTP ${response.status} sin JSON válido.`);
  }

  if (!response.ok || payload?.success !== true || !payload?.result) {
    const messages = Array.isArray(payload?.errors)
      ? payload.errors.map((error) => error?.message || error?.code).filter(Boolean).join("; ")
      : "";
    throw new Error(
      `Cloudflare no permitió ${method} del proyecto Pages (${response.status})${messages ? `: ${messages}` : "."}`
    );
  }

  return payload.result;
}

let project = await cloudflareRequest("GET");
const currentBranch = String(project.production_branch || "").trim();

if (currentBranch !== productionBranch) {
  console.log(
    `Alineando rama de producción de Pages: ${currentBranch || "(sin definir)"} -> ${productionBranch}`
  );
  await cloudflareRequest("PATCH", { production_branch: productionBranch });
}

project = await cloudflareRequest("GET");
const confirmedBranch = String(project.production_branch || "").trim();

if (confirmedBranch !== productionBranch) {
  throw new Error(
    `Cloudflare Pages conserva '${confirmedBranch || "(sin definir)"}' como production_branch; se esperaba '${productionBranch}'.`
  );
}

console.log(`Cloudflare Pages: ${projectName} | production_branch: ${confirmedBranch}`);
