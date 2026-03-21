const ENV_KEY = "oksskolten_clip_environment";
const TEST_BASE_URL_KEY = "oksskolten_clip_test_base_url";
const TEST_API_TOKEN_KEY = "oksskolten_clip_test_api_token";
const PRODUCTION_BASE_URL_KEY = "oksskolten_clip_production_base_url";
const PRODUCTION_API_TOKEN_KEY = "oksskolten_clip_production_api_token";

const LEGACY_BASE_URL_KEY = "oksskolten_clip_base_url";
const LEGACY_API_TOKEN_KEY = "oksskolten_clip_api_token";
const DEFAULT_BASE_URL = "https://oksskolten-atsushi.fly.dev";
const DEFAULT_ENVIRONMENT = "production";

function normalizeBaseUrl(rawBaseUrl) {
  const trimmed = String(rawBaseUrl || "").trim();
  if (!trimmed) return "";
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme);
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (isLocalhost && url.port === "5173") url.port = "3000";
  return url.toString().replace(/\/+$/, "");
}

function getInputValue(id) {
  return (document.getElementById(id)?.value || "").trim();
}

function setInputValue(id, value) {
  const el = document.getElementById(id);
  if (el) el.value = value;
}

async function load() {
  const data = await chrome.storage.local.get([
    ENV_KEY,
    TEST_BASE_URL_KEY,
    TEST_API_TOKEN_KEY,
    PRODUCTION_BASE_URL_KEY,
    PRODUCTION_API_TOKEN_KEY,
    LEGACY_BASE_URL_KEY,
    LEGACY_API_TOKEN_KEY,
  ]);

  const environment = data[ENV_KEY] || DEFAULT_ENVIRONMENT;
  const productionBaseUrl = data[PRODUCTION_BASE_URL_KEY] || data[LEGACY_BASE_URL_KEY] || DEFAULT_BASE_URL;
  const productionToken = data[PRODUCTION_API_TOKEN_KEY] || data[LEGACY_API_TOKEN_KEY] || "";
  const testBaseUrl = data[TEST_BASE_URL_KEY] || "";
  const testToken = data[TEST_API_TOKEN_KEY] || "";

  setInputValue("environment", environment);
  setInputValue("testBaseUrl", testBaseUrl);
  setInputValue("testToken", testToken);
  setInputValue("productionBaseUrl", productionBaseUrl);
  setInputValue("productionToken", productionToken);
}

async function save() {
  let testBaseUrl = "";
  let productionBaseUrl = "";

  try {
    testBaseUrl = normalizeBaseUrl(getInputValue("testBaseUrl"));
    productionBaseUrl = normalizeBaseUrl(getInputValue("productionBaseUrl"));
  } catch {
    alert("Base URL is invalid. Use http://localhost:3000 or your deployed URL.");
    return;
  }

  const environment = getInputValue("environment") === "test" ? "test" : DEFAULT_ENVIRONMENT;
  const testToken = getInputValue("testToken");
  const productionToken = getInputValue("productionToken");

  await chrome.storage.local.set({
    [ENV_KEY]: environment,
    [TEST_BASE_URL_KEY]: testBaseUrl,
    [TEST_API_TOKEN_KEY]: testToken,
    [PRODUCTION_BASE_URL_KEY]: productionBaseUrl,
    [PRODUCTION_API_TOKEN_KEY]: productionToken,
  });

  setInputValue("testBaseUrl", testBaseUrl);
  setInputValue("productionBaseUrl", productionBaseUrl);
  alert("Saved.");
}

document.getElementById("save").addEventListener("click", save);
load();
