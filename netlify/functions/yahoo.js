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

let cloudStore = {
  barkKey: "",
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
        30,
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
    "?sound=alarm&level=timeSensitive";
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
  const syms = [
    ...new Set(
      active.map(a => a.symbol)
    )
  ];
  const prices = {};
  for (const s of syms) {
    const p = await fetchLatestSpot(s);
    if (p != null) prices[s] = p;
  }
  const hitList = [];
  for (const item of cloudStore.alerts) {
    if (!item.isEnabled ||
      item.isTriggered) {
      continue;
    }
    const curP = prices[item.symbol];
    if (curP == null) continue;
    const ok = item.condition === "向上突破"
      ? curP >= item.targetPrice
      : curP <= item.targetPrice;
    if (ok) {
      item.isTriggered = true;
      item.isEnabled = false;
      item.triggeredPrice = curP;
      item.triggeredAt =
        new Date().toISOString();
      hitList.push(item);
      await pushToBark(
        cloudStore.barkKey,
        item,
        curP
      );
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
