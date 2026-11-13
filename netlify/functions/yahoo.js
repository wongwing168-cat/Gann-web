exports.handler = async (event) => {
  const qs =
    event.queryStringParameters || {};
  const sym = qs.symbol || "^HSI";
  const iv = qs.interval || "1wk";
  const rng = qs.range || "15y";
  const enc = encodeURIComponent(sym);
  const q = "/v8/finance/chart/" +
    enc + "?range=" + rng +
    "&interval=" + iv;
  const hosts = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com"
  ];
  const hdrs = {
    "User-Agent": "Mozilla/5.0",
    "Accept": "application/json"
  };
  for (const h of hosts) {
    try {
      const res = await fetch(
        h + q,
        { headers: hdrs }
      );
      if (!res.ok) continue;
      const body = await res.text();
      if (body.includes("timestamp")) {
        return {
          statusCode: 200,
          headers: {
            "Content-Type":
              "application/json",
            "Access-Control-Allow-Origin":
              "*"
          },
          body
        };
      }
    } catch (e) {}
  }
  return {
    statusCode: 502,
    headers: {
      "Content-Type":
        "application/json",
      "Access-Control-Allow-Origin":
        "*"
    },
    body: JSON.stringify({
      error: "Yahoo fetch failed"
    })
  };
};
