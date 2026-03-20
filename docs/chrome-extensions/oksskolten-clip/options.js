const BASE_URL_KEY = "oksskolten_clip_base_url";
const API_TOKEN_KEY = "oksskolten_clip_api_token";

const DEFAULT_BASE_URL = "https://oksskolten-atsushi.fly.dev";

async function load() {
  const data = await chrome.storage.local.get([BASE_URL_KEY, API_TOKEN_KEY]);
  const baseUrl = data[BASE_URL_KEY] || DEFAULT_BASE_URL;
  const token = data[API_TOKEN_KEY] || "";

  document.getElementById("baseUrl").value = baseUrl;
  document.getElementById("token").value = token;
}

async function save() {
  const baseUrl = (document.getElementById("baseUrl").value || "").trim();
  const token = (document.getElementById("token").value || "").trim();

  await chrome.storage.local.set({
    [BASE_URL_KEY]: baseUrl,
    [API_TOKEN_KEY]: token,
  });
  alert("Saved.");
}

document.getElementById("save").addEventListener("click", save);
load();
