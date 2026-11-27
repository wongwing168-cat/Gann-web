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
  close,
  volume
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
              {
                open,
                high,
                low,
                close,
                volume: volume || []
              }
            ]
          }
        }
      ]
    }
  };
  return JSON.stringify(obj);
}

function normBaseSym(sym) {
  let s = sym.trim().toUpperCase();
  if (s === "BRK.B") s = "BRK-B";
  if (s === "BRK.A") s = "BRK-A";
  return s;
}

function getTencentSpec(sym) {
  const s = normBaseSym(sym);
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
  if (!s.startsWith("^")) {
    const base = s.replace("-", ".");
    return {
      api: "usfqkline",
      codes: [
        "us" + base + ".N",
        "us" + base + ".OQ",
        "us" + base + ".P",
        "us" + base + ".A"
      ]
    };
  }
  return null;
}

async function fetchOneTencent(
  tc,
  api,
  per,
  cnt,
  sym
) {
  const host =
    "https://web.ifzq.gtimg.cn";
  const path =
    "/appstock/app/" + api + "/get";
  const param =
    tc + "," + per + ",,," +
    cnt + ",qfq";
  const url =
    host + path + "?param=" +
    encodeURIComponent(param);
  const hdrs = {
    "User-Agent": "Mozilla/5.0",
    "Referer":
      "https://gu.qq.com/"
  };
  try {
    const res = await fetchTimeout(
      url,
      hdrs,
      5000
    );
    if (!res.ok) return null;
    const j = await res.json();
    const node = j?.data?.[tc];
    if (!node) return null;
    const arr =
      node["qfq" + per] ||
      node[per];
    if (!Array.isArray(arr) ||
      arr.length < 2) {
      return null;
    }
    const qt = node.qt?.[tc];
    const cname = Array.isArray(qt)
      ? qt[1] : sym;
    const ts = [];
    const op = [];
    const hi = [];
    const lo = [];
    const cl = [];
    const vol = [];
    for (const r of arr) {
      const t = Math.floor(
        new Date(r[0]).getTime() /
        1000
      );
      if (isNaN(t)) continue;
      ts.push(t);
      op.push(parseFloat(r[1]));
      cl.push(parseFloat(r[2]));
      hi.push(parseFloat(r[3]));
      lo.push(parseFloat(r[4]));
      vol.push(
        parseFloat(r[5]) || 0
      );
    }
    if (ts.length < 2) return null;
    return {
      lastTs: ts[ts.length - 1],
      body: wrapChart(
        sym,
        cname,
        ts,
        op,
        hi,
        lo,
        cl,
        vol
      )
    };
  } catch (e) {
    return null;
  }
}

async function tryTencent(sym, iv) {
  if (
    iv === "15m" ||
    iv === "30m" ||
    iv === "60m"
  ) {
    return null;
  }
  const spec = getTencentSpec(sym);
  if (!spec) return null;
  const per = iv === "1mo"
    ? "month"
    : (iv === "1wk"
      ? "week" : "day");
  const cnt = iv === "1mo"
    ? 480 : 1260;

  const jobs = spec.codes.map(tc =>
    fetchOneTencent(
      tc,
      spec.api,
      per,
      cnt,
      sym
    )
  );
  const all = await Promise.all(jobs);
  const valid = all.filter(Boolean);
  if (valid.length === 0) return null;
  valid.sort(
    (a, b) => b.lastTs - a.lastTs
  );
  return valid[0].body;
}

function toStooqSym(sym) {
  const s = normBaseSym(sym);
  if (s === "^HSI") return "^hsi";
  if (s === "^IXIC") return "^ndq";
  if (s === "^GSPC") return "^spx";
  if (s === "^DJI") return "^dji";
  if (s.endsWith(".HK")) {
    const num = parseInt(
      s.slice(0, -3),
      10
    );
    if (!isNaN(num)) {
      return num + ".hk";
    }
    return s.toLowerCase();
  }
  if (!s.startsWith("^")) {
    return s.toLowerCase() + ".us";
  }
  return s.toLowerCase();
}

async function tryStooq(sym, iv) {
  if (
    iv === "15m" ||
    iv === "30m" ||
    iv === "60m"
  ) {
    return null;
  }
  const sqSym = toStooqSym(sym);
  const sqInt = iv === "1mo"
    ? "m"
    : (iv === "1wk" ? "w" : "d");
  const url =
    "https://stooq.com/q/d/l/?s=" +
    encodeURIComponent(sqSym) +
    "&i=" + sqInt;
  const res = await fetchTimeout(
    url,
    { "User-Agent": "Mozilla/5.0" },
    5000
  );
  if (!res.ok) return null;
  const csv = await res.text();
  const lines = csv.trim().split("\n");
  if (lines.length < 15) return null;
  const ts = [];
  const op = [];
  const hi = [];
  const lo = [];
  const cl = [];
  const vol = [];
  for (let i = 1; i < lines.length; i++) {
    const p = lines[i].split(",");
    if (p.length < 5) continue;
    const t = Math.floor(
      new Date(p[0]).getTime() / 1000
    );
    const c = parseFloat(p[4]);
    if (isNaN(t) || isNaN(c)) continue;
    ts.push(t);
    op.push(parseFloat(p[1]));
    hi.push(parseFloat(p[2]));
    lo.push(parseFloat(p[3]));
    cl.push(c);
    vol.push(parseFloat(p[5]) || 0);
  }
  if (ts.length < 10) return null;
  return wrapChart(
    sym,
    sym,
    ts,
    op,
    hi,
    lo,
    cl,
    vol
  );
}

async function tryYahooDirect(
  sym,
  iv,
  rng
) {
  const enc = encodeURIComponent(sym);
  const url =
    "https://query1.finance" +
    ".yahoo.com/v8/finance/chart/" +
    enc + "?range=" + rng +
    "&interval=" + iv +
    "&includePrePost=false";
  const hdrs = {
    "User-Agent":
      "Mozilla/5.0 (iPad; CPU OS " +
      "17_0 like Mac OS X)",
    "Accept": "application/json"
  };
  const res = await fetchTimeout(
    url,
    hdrs,
    5000
  );
  if (!res.ok) return null;
  const txt = await res.text();
  if (!txt.includes('"timestamp"')) {
    return null;
  }
  return txt;
}

async function tryYahooSearch(q) {
  const enc = encodeURIComponent(q);
  const url =
    "https://query1.finance" +
    ".yahoo.com/v1/finance/search" +
    "?q=" + enc +
    "&quotesCount=8&newsCount=0";
  const hdrs = {
    "User-Agent":
      "Mozilla/5.0 (iPad; CPU OS " +
      "17_0 like Mac OS X)",
    "Accept": "application/json"
  };
  try {
    const res = await fetchTimeout(
      url,
      hdrs,
      4500
    );
    if (!res.ok) {
      return '{"quotes":[]}';
    }
    return await res.text();
  } catch (e) {
    return '{"quotes":[]}';
  }
}

let cloudStore = {
  barkKey: "",
  ringTone: "alarm",
  alerts: []
};

async function fetchLatestSpot(sym) {
  const spec = getTencentSpec(sym);
  if (spec) {
    const jobs = spec.codes.map(tc =>
      fetchOneTencent(
        tc,
        spec.api,
        "day",
        20,
        sym
      )
    );
    const all = await Promise.all(jobs);
    const valid = all.filter(Boolean);
    if (valid.length > 0) {
      valid.sort(
        (a, b) => b.lastTs - a.lastTs
      );
      const obj = JSON.parse(
        valid[0].body
      );
      const cls = obj?.chart?.result?.[0]
        ?.indicators?.quote?.[0]?.close;
      if (Array.isArray(cls) &&
        cls.length > 0) {
        return cls[cls.length - 1];
      }
    }
  }
  const yh = await tryYahooDirect(
    sym,
    "1d",
    "5d"
  );
  if (yh) {
    const obj = JSON.parse(yh);
    const regP = obj?.chart?.result?.[0]
      ?.meta?.regularMarketPrice;
    if (typeof regP === "number") {
      return regP;
    }
  }
  return null;
}

async function pushToBark(
  barkKey,
  item,
  curPrice
) {
  if (!barkKey) return;
  const pStr = Number(curPrice)
    .toFixed(2);
  const tStr = Number(
    item.targetPrice
  ).toFixed(2);
  const snd = encodeURIComponent(
    cloudStore.ringTone || "alarm"
  );
  const title = encodeURIComponent(
    "🔔 " + item.symbol +
    " 到價 " + pStr
  );
  const body = encodeURIComponent(
    item.condition + " " + tStr +
    "｜方案：" + item.planNote
  );
  const url =
    "https://api.day.app/" +
    encodeURIComponent(barkKey) +
    "/" + title + "/" + body +
    "?sound=" + snd +
    "&level=timeSensitive";
  try {
    await fetchTimeout(url, {}, 5000);
  } catch (e) {}
}

async function runAlertScan() {
  const active = cloudStore.alerts
    .filter(
      a => a.isEnabled && !a.isTriggered
    );
  if (active.length === 0) {
    return {
      scanned: 0,
      triggered: []
    };
  }
  const needQuote = active.filter(
    a => !a.isPendingDelivery
  );
  const syms = [
    ...new Set(
      needQuote.map(a => a.symbol)
    )
  ];
  const prices = {};
  for (const s of syms) {
    const p = await fetchLatestSpot(s);
    if (p != null) prices[s] = p;
  }

  const hkNow = new Date(
    Date.now() + 8 * 3600 * 1000
  );
  const curMins =
    hkNow.getUTCHours() * 60 +
    hkNow.getUTCMinutes();

  const hitList = [];
  for (const item of cloudStore.alerts) {
    if (!item.isEnabled ||
      item.isTriggered) {
      continue;
    }

    if (!item.isPendingDelivery) {
      const curP = prices[item.symbol];
      if (curP == null) continue;
      const ok = item.condition === "向上突破"
        ? curP >= item.targetPrice
        : curP <= item.targetPrice;
      if (!ok) continue;

      item.triggeredPrice = curP;
      item.triggeredAt =
        new Date().toISOString();
      if (item.notifyMode ===
        "scheduled") {
        item.isPendingDelivery = true;
      } else {
        item.isTriggered = true;
        item.isEnabled = false;
        hitList.push(item);
        await pushToBark(
          cloudStore.barkKey,
          item,
          curP
        );
        continue;
      }
    }

    if (item.isPendingDelivery) {
      const sh = Number(
        item.schedHour ?? 8
      );
      const sm = Number(
        item.schedMinute ?? 30
      );
      const dueMins = sh * 60 + sm;
      if (curMins >= dueMins) {
        item.isPendingDelivery = false;
        item.isTriggered = true;
        item.isEnabled = false;
        hitList.push(item);
        const p = item.triggeredPrice ??
          item.targetPrice;
        await pushToBark(
          cloudStore.barkKey,
          item,
          p
        );
      }
    }
  }
  return {
    scanned: syms.length,
    triggered: hitList,
    alerts: cloudStore.alerts
  };
}

exports.handler = async (event) => {
  const qs =
    event.queryStringParameters || {};
  const act = qs.action || "chart";
  const corsHdr = {
    "Content-Type":
      "application/json",
    "Access-Control-Allow-Origin":
      "*"
  };

  if (act === "sync_alerts") {
    try {
      const payload = JSON.parse(
        event.body || "{}"
      );
      if (payload.barkKey != null) {
        cloudStore.barkKey =
          String(payload.barkKey).trim();
      }
      if (payload.ringTone != null) {
        cloudStore.ringTone =
          String(payload.ringTone).trim();
      }
      if (Array.isArray(
        payload.alerts
      )) {
        cloudStore.alerts =
          payload.alerts;
      }
    } catch (e) {}
    return {
      statusCode: 200,
      headers: corsHdr,
      body: JSON.stringify({
        ok: true,
        count: cloudStore.alerts.length
      })
    };
  }

  if (act === "check_alerts") {
    const res = await runAlertScan();
    return {
      statusCode: 200,
      headers: corsHdr,
      body: JSON.stringify(res)
    };
  }

  if (act === "search") {
    const q = qs.q || "";
    const body = await tryYahooSearch(q);
    return {
      statusCode: 200,
      headers: corsHdr,
      body
    };
  }

  const sym = qs.symbol || "^HSI";
  const iv = qs.interval || "1wk";
  const rng = qs.range || "15y";

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
