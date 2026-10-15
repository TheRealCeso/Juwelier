(() => {
  const loadButton = document.getElementById("metal-prices-load");
  if (!loadButton) return;

  const status = document.getElementById("metal-prices-status");
  const fxDate = document.getElementById("metal-fx-date");
  const fields = {
    XAU: {
      price: document.getElementById("gold-price"),
      time: document.getElementById("gold-price-time")
    },
    XAG: {
      price: document.getElementById("silver-price"),
      time: document.getElementById("silver-price-time")
    }
  };
  const troyOunceInGrams = 31.1034768;
  const state = { phase: "initial", rates: null };

  function translate(source) {
    return window.translateUiText?.(source) ?? source;
  }

  function locale() {
    return { de: "de-DE", en: "en-GB", tr: "tr-TR" }[document.documentElement.lang] ?? "de-DE";
  }

  function render() {
    const messages = {
      initial: "Kursdaten auf Wunsch laden.",
      loading: "Kurse werden geladen …",
      ready: "Kurse geladen.",
      error: "Kursdaten derzeit nicht verfügbar. Bitte später erneut versuchen."
    };
    status.textContent = translate(messages[state.phase]);
    loadButton.disabled = state.phase === "loading";
    loadButton.setAttribute("aria-busy", String(state.phase === "loading"));

    for (const symbol of ["XAU", "XAG"]) {
      const field = fields[symbol];
      const rate = state.rates?.[symbol];
      field.price.textContent = rate
        ? new Intl.NumberFormat(locale(), { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(rate.eurPerGram)
        : "—";
      field.time.textContent = rate
        ? `${translate("Stand:")} ${new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Berlin" }).format(rate.updatedAt)}`
        : "";
      if (rate) field.time.dateTime = new Date(rate.updatedAt).toISOString();
      else field.time.removeAttribute("datetime");
    }

    fxDate.textContent = state.rates
      ? ` · ${translate("USD/EUR vom")} ${new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeZone: "UTC" }).format(new Date(`${state.rates.fxDate}T12:00:00Z`))}`
      : "";
  }

  async function getJson(url, signal) {
    const response = await fetch(url, {
      mode: "cors",
      credentials: "omit",
      referrerPolicy: "no-referrer",
      cache: "no-store",
      signal
    });
    if (!response.ok) throw new Error(`Kursanbieter: ${response.status}`);
    return response.json();
  }

  function validateMetal(data, symbol) {
    const updatedAt = Date.parse(data?.updatedAt);
    const age = Date.now() - updatedAt;
    if (data?.symbol !== symbol || data?.currency !== "USD" ||
        !Number.isFinite(data.price) || data.price <= 0 ||
        !Number.isFinite(updatedAt) || age < -300000 || age > 96 * 60 * 60 * 1000) {
      throw new Error("Ungültiger oder veralteter Metallkurs");
    }
    return { usdPerOunce: data.price, updatedAt };
  }

  function validateFx(data) {
    const date = data?.date;
    const updatedAt = /^\d{4}-\d{2}-\d{2}$/.test(date ?? "")
      ? Date.parse(`${date}T00:00:00Z`)
      : NaN;
    const age = Date.now() - updatedAt;
    if (data?.base?.toUpperCase() !== "USD" || data?.quote?.toUpperCase() !== "EUR" ||
        !Number.isFinite(data.rate) || data.rate <= 0 ||
        !Number.isFinite(updatedAt) || age < -86400000 || age > 10 * 86400000) {
      throw new Error("Ungültiger oder veralteter Wechselkurs");
    }
    return { rate: data.rate, date };
  }

  loadButton.addEventListener("click", async () => {
    if (state.phase === "loading") return;
    state.phase = "loading";
    state.rates = null;
    render();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const [goldResponse, fxResponse] = await Promise.all([
        getJson("https://api.gold-api.com/price/XAU", controller.signal),
        getJson("https://api.frankfurter.dev/v2/rate/usd/eur", controller.signal)
      ]);
      const silverResponse = await getJson("https://api.gold-api.com/price/XAG", controller.signal);
      const gold = validateMetal(goldResponse, "XAU");
      const silver = validateMetal(silverResponse, "XAG");
      const fx = validateFx(fxResponse);
      state.rates = {
        XAU: { eurPerGram: gold.usdPerOunce * fx.rate / troyOunceInGrams, updatedAt: gold.updatedAt },
        XAG: { eurPerGram: silver.usdPerOunce * fx.rate / troyOunceInGrams, updatedAt: silver.updatedAt },
        fxDate: fx.date
      };
      state.phase = "ready";
    } catch {
      state.phase = "error";
      state.rates = null;
    } finally {
      clearTimeout(timeout);
      render();
    }
  });

  document.addEventListener("juwelier-language-change", render);
  render();
})();
