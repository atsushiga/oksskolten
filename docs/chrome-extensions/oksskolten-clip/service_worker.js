const DEFAULT_BASE_URL = "https://oksskolten-atsushi.fly.dev";
const BASE_URL_KEY = "oksskolten_clip_base_url";
const API_TOKEN_KEY = "oksskolten_clip_api_token";

function notify(title, message) {
  // まずはクリップの成功/失敗の本体処理を止めないため、
  // notifications は無効化（icon svg 取得失敗などで Promise rejection が出るため）。
  // 必要なら PNG アイコンを追加して通知を復活できます。
  // eslint-disable-next-line no-console
  console.log(`[Oksskolten Clip] ${title}: ${message}`)
}

function setBadge(text, color) {
  try {
    if (typeof text === "string") chrome.action.setBadgeText({ text })
    if (typeof color === "string") chrome.action.setBadgeBackgroundColor({ color })
  } catch {
    // badge が利用できない環境でも処理は続ける
  }
}

function normalizeBaseUrl(rawBaseUrl) {
  const trimmed = String(rawBaseUrl || "").trim();
  const withScheme = /^[a-z]+:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const url = new URL(withScheme);
  const isLocalhost = url.hostname === "localhost" || url.hostname === "127.0.0.1";
  if (isLocalhost && url.port === "5173") url.port = "3000";
  return url.toString().replace(/\/+$/, "");
}

function getTabHtml(tabId) {
  return new Promise((resolve) => {
    chrome.scripting.executeScript(
      {
        target: { tabId },
        func: () => document.documentElement?.outerHTML || null,
      },
      (results) => {
        if (chrome.runtime.lastError) {
          resolve(null);
          return;
        }
        resolve(results?.[0]?.result || null);
      },
    );
  });
}

async function clipUrl(tab, force = false) {
  const pageUrl = tab?.url || null;
  setBadge("CLIP", "#9ca3af");
  const data = await chrome.storage.local.get([BASE_URL_KEY, API_TOKEN_KEY]);
  let baseUrl;
  try {
    baseUrl = normalizeBaseUrl(data[BASE_URL_KEY] || DEFAULT_BASE_URL);
  } catch {
    setBadge("BASE", "#ef4444");
    notify("Oksskolten Clip", "Base URL is invalid. Use http://localhost:3000 or your deployed URL.");
    return;
  }
  const token = (data[API_TOKEN_KEY] || "").trim();

  if (!token) {
    setBadge("TOKEN", "#ef4444");
    notify("Oksskolten Clip", "API token is not set. Open extension options.");
    return;
  }

  if (!pageUrl || !pageUrl.startsWith("https://")) {
    setBadge("NOURL", "#ef4444");
    notify("Oksskolten Clip", "Only https:// URLs can be clipped.");
    return;
  }

  const pageHtml = tab?.id ? await getTabHtml(tab.id) : null;

  let res;
  let body = {};
  try {
    res = await fetch(`${baseUrl}/api/articles/from-url`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        url: pageUrl,
        html: typeof pageHtml === "string" && pageHtml.length > 0 ? pageHtml : undefined,
        force,
      }),
    });
    body = await res.json().catch(() => ({}));
  } catch (e) {
    setBadge("NG", "#ef4444");
    notify("Oksskolten Clip failed", e instanceof Error ? e.message : String(e));
    return;
  }

  if (res.status === 201 || res.status === 200) {
    setBadge("OK", "#22c55e");
    notify("Oksskolten Clip", "Clipped successfully.");
    return;
  }

  // RSS側に存在していて move 可能な場合（UIと同じロジック）
  if (res.status === 409 && body?.can_force === true && force === false) {
    await clipUrl(tab, true);
    return;
  }

  setBadge("NG", "#ef4444");
  const msg = body?.error ? String(body.error) : `HTTP ${res.status}`;
  notify("Oksskolten Clip failed", msg);
}

chrome.action.onClicked.addListener(async (tab) => {
  if (!tab?.url) {
    setBadge("NOURL", "#ef4444");
    notify("Oksskolten Clip", "No active tab URL.");
    return;
  }
  await clipUrl(tab, false);
});
