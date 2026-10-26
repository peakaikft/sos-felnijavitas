// ============================================================================
// SOS Felnijavítás — közös adatréteg (index.html, ajanlat-board.html,
// ugyfel-nezet.html mindegyike ezt használja).
//
// Két üzemmód:
//  - ÉLES: ha a supabase-config.js-ben ki van töltve a SUPABASE_URL és
//    SUPABASE_ANON_KEY, valódi Supabase adatbázist/auth-ot/storage-ot használ.
//  - DEMO: ha a konfiguráció üres, a böngésző localStorage-ját használja
//    adatbázis helyett, hogy a teljes folyamat (beküldés → pultos nézet →
//    állapotváltás → ügyfél nézet) élő backend nélkül is kipróbálható legyen.
//
// Minden függvény ugyanazt a { data, error } alakot adja vissza, függetlenül
// az üzemmódtól, hogy a hívó oldalak (index/board/ugyfel) ne kelljenek
// tudjanak arról, melyik módban futnak.
// ============================================================================

(function (global) {
  "use strict";

  var DEMO_KEY = "sos_felni_demo_leads";
  var isDemo = !(global.SUPABASE_URL && global.SUPABASE_ANON_KEY);

  function uuidv4() {
    // Robusztus UUID-generálás — nem támaszkodik crypto.randomUUID()-ra,
    // mert az csak "secure context"-ben (https / localhost) elérhető.
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function readDemoStore() {
    try {
      var raw = global.localStorage.getItem(DEMO_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function writeDemoStore(list) {
    try {
      global.localStorage.setItem(DEMO_KEY, JSON.stringify(list));
    } catch (e) { /* localStorage nem elérhető — csendben elnyeljük */ }
  }

  // ---- ÉLES kliens létrehozása (csak ha konfigurálva van) -------------------
  var client = null;
  if (!isDemo && global.supabase && typeof global.supabase.createClient === "function") {
    client = global.supabase.createClient(global.SUPABASE_URL, global.SUPABASE_ANON_KEY);
  } else if (!isDemo) {
    // Konfiguráció ki van töltve, de a Supabase JS könyvtár nem töltődött be
    // (pl. nincs internet a CDN-hez) — essünk vissza demo módra, hogy a
    // oldal ne szálljon el, csak jelezzük a konzolon.
    console.warn("[SOS Felnijavítás] Supabase konfiguráció megvan, de a kliens könyvtár nem töltődött be — demo módra váltás.");
    isDemo = true;
  }

  // ---- CREATE (kalkulátor + fotó-form beküldése) -----------------------------
  function create(lead) {
    var shareToken = (lead && lead.share_token) || uuidv4();
    var record = Object.assign({
      id: uuidv4(),
      share_token: shareToken,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
      allapot: "uj",
      gumiszereles: false,
      fotok: [],
      vegleges_ar: null,
      staff_megjegyzes: null
    }, lead, { share_token: shareToken });

    if (isDemo) {
      var list = readDemoStore();
      list.unshift(record);
      writeDemoStore(list);
      return Promise.resolve({ data: record, error: null });
    }

    // Élesben nem kérünk .select()-et vissza — anon csak INSERT jogot kap,
    // a megerősítő linkhez a share_token-t már itt, kliens oldalon ismerjük.
    var insertRow = Object.assign({}, lead, {
      id: record.id,
      share_token: shareToken
    });
    return client.from("sos_felni_leads").insert([insertRow]).then(function (res) {
      if (res.error) return { data: null, error: res.error };
      return { data: record, error: null };
    });
  }

  // ---- FOTÓ FELTÖLTÉS ---------------------------------------------------------
  function uploadFotok(shareToken, fileList) {
    var files = Array.prototype.slice.call(fileList || []);
    if (!files.length) return Promise.resolve({ data: [], error: null });

    if (isDemo) {
      // Demo módban nem tárolunk valódi fájlt, csak a neveket jegyezzük meg,
      // hogy a folyamat végigkattintható legyen.
      return Promise.resolve({ data: files.map(function (f) { return "demo:" + f.name; }), error: null });
    }

    var uploads = files.map(function (file) {
      var path = shareToken + "/" + Date.now() + "_" + file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
      return client.storage.from("sos-felni-fotok").upload(path, file).then(function (res) {
        if (res.error) throw res.error;
        return path;
      });
    });

    return Promise.all(uploads)
      .then(function (paths) { return { data: paths, error: null }; })
      .catch(function (err) { return { data: null, error: err }; });
  }

  function getFotoUrl(path) {
    if (isDemo || !path || path.indexOf("demo:") === 0) {
      return Promise.resolve({ data: null, error: null });
    }
    return client.storage.from("sos-felni-fotok").createSignedUrl(path, 3600).then(function (res) {
      if (res.error) return { data: null, error: res.error };
      return { data: res.data.signedUrl, error: null };
    });
  }

  // ---- ÜGYFÉL SAJÁT NÉZETE (token alapján) -----------------------------------
  function getByToken(token) {
    if (isDemo) {
      var found = readDemoStore().filter(function (l) { return l.share_token === token; })[0];
      return Promise.resolve({ data: found || null, error: found ? null : { message: "Nincs ilyen lead." } });
    }
    return client.rpc("get_sos_felni_lead_by_token", { p_token: token }).then(function (res) {
      if (res.error) return { data: null, error: res.error };
      var row = (res.data && res.data[0]) || null;
      return { data: row, error: row ? null : { message: "Nincs ilyen lead." } };
    });
  }

  // ---- PULTOS NÉZET: összes lead ----------------------------------------------
  function listAll() {
    if (isDemo) {
      var list = readDemoStore().sort(function (a, b) {
        return new Date(b.created_at) - new Date(a.created_at);
      });
      return Promise.resolve({ data: list, error: null });
    }
    return client.from("sos_felni_leads").select("*").order("created_at", { ascending: false }).then(function (res) {
      return { data: res.data, error: res.error };
    });
  }

  function update(id, patch) {
    if (isDemo) {
      var list = readDemoStore();
      var idx = list.findIndex(function (l) { return l.id === id; });
      if (idx === -1) return Promise.resolve({ data: null, error: { message: "Nincs ilyen lead." } });
      list[idx] = Object.assign({}, list[idx], patch, { updated_at: new Date().toISOString() });
      writeDemoStore(list);
      return Promise.resolve({ data: list[idx], error: null });
    }
    return client.from("sos_felni_leads").update(patch).eq("id", id).select().then(function (res) {
      if (res.error) return { data: null, error: res.error };
      return { data: res.data && res.data[0], error: null };
    });
  }

  // ---- AUTH (csak éles módban releváns — a pultos nézet védelméhez) ----------
  var auth = {
    isDemo: isDemo,
    signIn: function (email, password) {
      if (isDemo) return Promise.resolve({ data: { user: { email: "demo" } }, error: null });
      return client.auth.signInWithPassword({ email: email, password: password });
    },
    signOut: function () {
      if (isDemo) return Promise.resolve({ error: null });
      return client.auth.signOut();
    },
    getSession: function () {
      if (isDemo) return Promise.resolve({ data: { session: { user: { email: "demo" } } } });
      return client.auth.getSession();
    },
    onChange: function (cb) {
      if (isDemo) return function () {}; // nincs mit leiratkozni
      var sub = client.auth.onAuthStateChange(function (_event, session) { cb(session); });
      return function () { sub.data.subscription.unsubscribe(); };
    }
  };

  global.Leads = {
    isDemo: isDemo,
    newToken: uuidv4,
    create: create,
    uploadFotok: uploadFotok,
    getFotoUrl: getFotoUrl,
    getByToken: getByToken,
    listAll: listAll,
    update: update,
    auth: auth
  };
})(window);
