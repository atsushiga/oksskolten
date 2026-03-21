const BASE_URL_KEY = "oksskolten_clip_base_url";
const API_TOKEN_KEY = "oksskolten_clip_api_token";

const DEFAULT_BASE_URL = "https://oksskolten-atsushi.fly.dev";

function normalizeBaseUrl(rawBaseUrl) {
  const trimmed = String(rawBaseUrl || "").trim();
  if (!trimmed) return "";
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme);
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (isLocalhost && url.port === "5173") url.port = "3000";
  return url.toString().replace(/\/+$/, "");
}

async function load() {
  const data = await chrome.storage.local.get([BASE_URL_KEY, API_TOKEN_KEY]);
  const baseUrl = data[BASE_URL_KEY] || DEFAULT_BASE_URL;
  const token = data[API_TOKEN_KEY] || "";

  document.getElementById("baseUrl").value = baseUrl;
  document.getElementById("token").value = token;
}

async function save() {
  const rawBaseUrl = (document.getElementById("baseUrl").value || "").trim();
  const token = (document.getElementById("token").value || "").trim();
  let baseUrl = "";

  try {
    baseUrl = normalizeBaseUrl(rawBaseUrl);
  } catch {
    alert("Base URL is invalid. Use http://localhost:3000 or your deployed URL.");
    return;
  }

  await chrome.storage.local.set({
    [BASE_URL_KEY]: baseUrl,
    [API_TOKEN_KEY]: token,
  });
  document.getElementById("baseUrl").value = baseUrl;
  alert("Saved.");
}

document.getElementById("save").addEventListener("click", save);
load();
