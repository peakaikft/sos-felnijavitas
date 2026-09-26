// ============================================================================
// SOS Felnijavítás — Supabase kapcsolat beállítása
// ============================================================================
// Amíg ez a két érték üresen marad, a teljes rendszer (kalkulátor, fotó-form,
// pultos nézet, ügyfél nézet) DEMO MÓDBAN fut: a böngésző saját tárolóját
// (localStorage) használja adatbázis helyett, így minden funkció kipróbálható
// élő Supabase projekt nélkül is — de az adatok csak az adott böngészőben,
// az adott gépen léteznek, és nem oszthatók meg mással.
//
// Éles működéshez (lásd supabase-schema.sql alján a lépéseket):
//   1. Hozz létre egy Supabase projektet: https://supabase.com/dashboard
//   2. Project Settings → API → másold ki az alábbi két értéket.
//   3. Írd be ide, mentsd el, töltsd fel a fájlt oda, ahol az index.html van.
// ============================================================================

window.SUPABASE_URL = "";
window.SUPABASE_ANON_KEY = "";
