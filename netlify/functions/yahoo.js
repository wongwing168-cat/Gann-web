const UAS = [
  "Mozilla/5.0 (Macintosh; Intel " +
    "Mac OS X 10_15_7) AppleWebKit/" +
    "537.36 Chrome/128.0.0.0",
  "Mozilla/5.0 (Windows NT 10.0; " +
    "Win64; x64) AppleWebKit/537.36 " +
    "Edg/128.0.0.0",
  "Mozilla/5.0 (iPad; CPU OS 17_6 " +
    "like Mac OS X) AppleWebKit/" +
    "605.1.15 Safari/604.1"
];

function pickUA() {
  const i = Math.floor(
    Math.random() * UAS.length
  );
  return UAS[i];
}

async function fetchWithTimeout(
  url,
  headers,
  ms
) {
  const ctrl = new AbortController();
  const tid = setTimeout(
    () => ctrl.abort(),
    ms
  );
  try {
    const res = await fetch(url, {
      headers,
      signal: ctrl.signal
    });
    clearTimeout(tid);
    return res;
  } catch (e) {
    clearTimeout(tid);
    throw e;
  }
}

function toStooqSym(sym) {
  const s = sym.trim().toUpperCase();
  if (s === "^HSI") return "^hsi";
  if (s === "^IXIC") return "^ndq";
  if (s === "^GSPC") return "^spx";
  if (s === "^DJI") return "^dji";
  if (s.endsWith(".HK")) {
    const raw = s.slice(0, -3);
    const num = parseInt(raw, 10);
    if (!isNaN(num)) {
      return num + ".hk";
    }
    return raw.toLowerCase() + ".hk";
  }
  if (!s.startsWith("^") &&
    !s.includes(".")) {
    return s.toLowerCase() + ".us";
  }
  return s.toLowerCase();
}

async function tryStooq(sym, iv) {
  const stSym = toStooqSym(sym);
  let iCode = "d";
  if (iv === "1wk") iCode = "w";
  if (iv === "1mo") iCode = "m";
  const url =
    "https://stooq.com/q/d/l/?s=" +
    encodeURIComponent(stSym) +
    "&i=" + iCode;
  const res = await fetchWithTimeout(
    url,
    { "User-Agent": pickUA() },
    6500
  );
  if (!res.ok) return null;
  const csv = await res.text();
  if (!csv.startsWith("Date,Open")) {
    return null;
  }
  const rows = csv.trim().split("\n");
  if (rows.length < 25) return null;

  const ts = [];
  const open = [];
  const high = [];
  const low = [];
  const close = [];

  for (let i = 1; i < rows.length; i++) {
    const cols = rows[i].split(",");
    if (cols.length < 5) continue;
    const dMs = Date.parse(
      cols[0] + "T00:00:00Z"
    );
    const o = parseFloat(cols[1]);
    const h = parseFloat(cols[2]);
    const l = parseFloat(cols[3]);
    const c = parseFloat(cols[4]);
    if (isNaN(dMs) || isNaN(c)) {
      continue;
    }
    ts.push(Math.floor(dMs / 1000));
    open.push(o);
    high.push(h);
    low.push(l);
    close.push(c);
  }
  if (ts.length < 20) return null;

  const wrapped = {
    chart: {
      result: [
        {
          meta: { shortName: sym },
          timestamp: ts,
          indicators: {
            quote: [
              { open, high, low, close }
            ]
          }
        }
      ]
    }
  };
  return JSON.stringify(wrapped);
}

exports.handler = async (event) => {
  const qs =
    event.queryStringParameters || {};
  const sym = qs.symbol || "^HSI";
  const iv = qs.interval || "1wk";
  const rng = qs.range || "15y";
  const enc = encodeURIComponent(sym);

  const ranges = [rng];
  if (rng !== "5y") {
    ranges.push("5y");
  }

  const hosts = [
    "https://query1.finance.yahoo.com",
    "https://query2.finance.yahoo.com"
  ];

  const corsHdr = {
    "Content-Type":
      "application/json",
    "Access-Control-Allow-Origin":
      "*"
  };

  for (const r of ranges) {
    const q = "/v8/finance/chart/" +
      enc + "?range=" + r +
      "&interval=" + iv +
      "&events=history";
    for (let i = 0;
      i < hosts.length; i++) {
      const hdrs = {
        "User-Agent": pickUA(),
        "Accept": "application/json",
        "Accept-Language":
          "en-US,en;q=0.9",
        "Referer":
          "https://finance.yahoo.com/"
      };
      try {
        const res =
          await fetchWithTimeout(
            hosts[i] + q,
            hdrs,
            5500
          );
        if (!res.ok) continue;
        const body = await res.text();
        if (
          body.includes("timestamp")
        ) {
          return {
            statusCode: 200,
            headers: {
              ...corsHdr,
              "X-Source":
                "Yahoo-" + (i + 1)
            },
            body
          };
        }
      } catch (e) {}
    }
  }

  try {
    const stooqJson = await tryStooq(
      sym,
      iv
    );
    if (stooqJson) {
      return {
        statusCode: 200,
        headers: {
          ...corsHdr,
          "X-Source": "Stooq-Backup"
        },
        body: stooqJson
      };
    }
  } catch (e) {}

  return {
    statusCode: 502,
    headers: corsHdr,
    body: JSON.stringify({
      error: "All upstreams busy"
    })
  };
};
