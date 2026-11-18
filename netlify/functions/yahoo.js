async function fetchTimeout(
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

function wrapChart(
  sym,
  name,
  ts,
  open,
  high,
  low,
  close
) {
  const obj = {
    chart: {
      result: [
        {
          meta: {
            shortName: name || sym
          },
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
  return JSON.stringify(obj);
}

function getTencentSpec(sym) {
  const s = sym.trim().toUpperCase();
  if (s === "^HSI") {
    return {
      api: "hkfqkline",
      codes: ["hkHSI"]
    };
  }
  if (s === "^HSCE") {
    return {
      api: "hkfqkline",
      codes: ["hkHSCEI"]
    };
  }
  if (s === "^IXIC") {
    return {
      api: "usfqkline",
      codes: ["us.IXIC"]
    };
  }
  if (s === "^GSPC") {
    return {
      api: "usfqkline",
      codes: ["us.INX"]
    };
  }
  if (s === "^DJI") {
    return {
      api: "usfqkline",
      codes: ["us.DJI"]
    };
  }
  if (s.endsWith(".HK")) {
    const raw = s.slice(0, -3);
    const num = parseInt(raw, 10);
    if (!isNaN(num)) {
      const pad = String(num)
        .padStart(5, "0");
      return {
        api: "hkfqkline",
        codes: ["hk" + pad]
      };
    }
    return {
      api: "hkfqkline",
      codes: ["hk" + raw]
    };
  }
  if (!s.startsWith("^") &&
    !s.includes(".")) {
    return {
      api: "usfqkline",
      codes: [
        "us" + s + ".OQ",
        "us" + s + ".N"
      ]
    };
  }
  return null;
}

async function tryTencent(sym, iv) {
  const spec = getTencentSpec(sym);
  if (!spec) return null;

  let per = "day";
  let cnt = 1000;
  if (iv === "1wk") {
    per = "week";
    cnt = 800;
  } else if (iv === "1mo") {
    per = "month";
    cnt = 400;
  }

  for (const tc of spec.codes) {
    const p = tc + "," + per +
      ",,," + cnt + ",qfq";
    const url =
      "https://web.ifzq.gtimg.cn" +
      "/appstock/app/" + spec.api +
      "/get?param=" +
      encodeURIComponent(p);
    try {
      const res = await fetchTimeout(
        url,
        {
          "User-Agent": "Mozilla/5.0"
        },
        6000
      );
      if (!res.ok) continue;
      const j = await res.json();
      const node = j?.data?.[tc];
      if (!node) continue;

      const rows =
        node["qfq" + per] ||
        node[per];
      if (!Array.isArray(rows) ||
        rows.length < 25) {
        continue;
      }

      const qtArr = node.qt?.[tc];
      const cnName =
        Array.isArray(qtArr) &&
        qtArr[1]
          ? String(qtArr[1])
          : sym;

      const ts = [];
      const open = [];
      const high = [];
      const low = [];
      const close = [];

      for (const r of rows) {
        if (!Array.isArray(r) ||
          r.length < 5) {
          continue;
        }
        const dMs = Date.parse(
          r[0] + "T00:00:00Z"
        );
        const o = parseFloat(r[1]);
        const c = parseFloat(r[2]);
        const h = parseFloat(r[3]);
        const l = parseFloat(r[4]);
        if (isNaN(dMs) ||
          isNaN(c)) {
          continue;
        }
        ts.push(
          Math.floor(dMs / 1000)
        );
        open.push(o);
        high.push(h);
        low.push(l);
        close.push(c);
      }

      if (ts.length >= 25) {
        return wrapChart(
          sym,
          cnName,
          ts,
          open,
          high,
          low,
          close
        );
      }
    } catch (e) {}
  }
  return null;
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
  const res = await fetchTimeout(
    url,
    { "User-Agent": "Mozilla/5.0" },
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
  return wrapChart(
    sym,
    sym,
    ts,
    open,
    high,
    low,
    close
  );
}

async function tryYahooDirect(
  sym,
  iv,
  rng
) {
  const enc = encodeURIComponent(sym);
  const hosts = [
    "query1.finance.yahoo.com",
    "query2.finance.yahoo.com"
  ];
  const hdr = {
    "User-Agent":
      "Mozilla/5.0 (Macintosh; " +
      "Intel Mac OS X 10_15_7)",
    Accept: "application/json"
  };
  for (const h of hosts) {
    const url =
      "https://" + h +
      "/v8/finance/chart/" + enc +
      "?range=" + rng +
      "&interval=" + iv;
    try {
      const res = await fetchTimeout(
        url,
        hdr,
        5500
      );
      if (!res.ok) continue;
      const txt = await res.text();
      if (txt.includes('"timestamp"')) {
        return txt;
      }
    } catch (e) {}
  }
  return null;
}

exports.handler = async (event) => {
  const qs =
    event.queryStringParameters || {};
  const sym = qs.symbol || "^HSI";
  const iv = qs.interval || "1wk";
  const rng = qs.range || "15y";

  const corsHdr = {
    "Content-Type":
      "application/json",
    "Access-Control-Allow-Origin":
      "*"
  };

  try {
    const tq = await tryTencent(
      sym,
      iv
    );
    if (tq) {
      return {
        statusCode: 200,
        headers: {
          ...corsHdr,
          "X-Source": "Tencent-HKUS"
        },
        body: tq
      };
    }
  } catch (e) {}

  try {
    const sq = await tryStooq(
      sym,
      iv
    );
    if (sq) {
      return {
        statusCode: 200,
        headers: {
          ...corsHdr,
          "X-Source": "Stooq-Backup"
        },
        body: sq
      };
    }
  } catch (e) {}

  try {
    const yh = await tryYahooDirect(
      sym,
      iv,
      rng
    );
    if (yh) {
      return {
        statusCode: 200,
        headers: {
          ...corsHdr,
          "X-Source": "Yahoo-Direct"
        },
        body: yh
      };
    }
  } catch (e) {}

  return {
    statusCode: 502,
    headers: corsHdr,
    body: JSON.stringify({
      error: "All engines failed"
    })
  };
};
