// /backend/eer.js  (CommonJS)

// ===================== KALORIE =====================
// computeEER obsługuje dwa tryby:
//  - 'mifflin' : Mifflin–St Jeor (BMR) × AF (aktywny dla "basic")
//  - 'eer'     : DRI 2005 EER (aktywny dla "advanced")
function computeEER({ sex, age, heightCm, weightKg, activity, mode = 'eer' }) {
  if (!(sex === 'female' || sex === 'male')) throw new Error('Bad sex');

  if (mode === 'mifflin') {
    // BMR: Mifflin–St Jeor (AJCN 1990)
    const bmr = (sex === 'male')
      ? 10 * weightKg + 6.25 * heightCm - 5 * age + 5
      : 10 * weightKg + 6.25 * heightCm - 5 * age - 161;

    // AF – mapowanie 1..5 (dopasowane do odczuć użytkowników i popularnych kalkulatorów)
    // 1: znikoma ~1.30, 2: lekka ~1.45, 3: umiarkowana ~1.60, 4: wysoka ~1.75, 5: bardzo wysoka ~1.90
    const AF = ({ 1: 1.30, 2: 1.45, 3: 1.60, 4: 1.75, 5: 1.90 })[activity] || 1.30;

    return { eerKcal: Math.round(bmr * AF), pa: AF, mode: 'mifflin' };
  }

  // DRI 2005 EER (TEE) – z wbudowanym współczynnikiem PA
  const h_m = heightCm / 100;
  const PA = (sex === 'female')
    ? ({1:1.00,2:1.12,3:1.20,4:1.27,5:1.45})[activity] || 1.00
    : ({1:1.00,2:1.11,3:1.18,4:1.25,5:1.48})[activity] || 1.00;

  const eer = (sex === 'male')
    ? 662 - 9.53 * age + PA * (15.91 * weightKg + 539.6 * h_m)
    : 354 - 6.91 * age + PA * ( 9.36 * weightKg + 726.0 * h_m);

  return { eerKcal: Math.round(eer), pa: PA, mode: 'eer' };
}

// ===================== BASIC (po staremu: procenty) =====================
function beginnerSplitKcal(eerKcal) {
  // ~52.4% C / 26.2% F / 21.4% P — Twoje dotychczasowe wartości
  const pct = { carbs: 0.5238, fat: 0.2619, protein: 0.2143 };
  return {
    kcal: eerKcal,
    carbs_g: +(eerKcal * pct.carbs / 4).toFixed(1),
    fat_g:   +(eerKcal * pct.fat   / 9).toFixed(1),
    protein_g:+(eerKcal * pct.protein/4).toFixed(1),
    meta: { basis: 'percent split (basic)' }
  };
}

// ===================== ATHLETE (zaawansowany) – bezpieczna wersja =====================
function advancedSplit(eerKcal, weightKg, opts) {
  return advancedSplitSmart(eerKcal, weightKg, opts);
}

/**
 * Smart split dla sportowców:
 * - protein: 1.6–2.2 g/kg (przy "loss" do 2.4 g/kg)
 * - fat:     >= max(20% kcal, 0.8 g/kg)   <-- bezpieczne minimum tłuszczu
 * - carbs:   wg dyscypliny i obciążenia (1..5); domyślnie 'mixed', level=3.
 */
function advancedSplitSmart(eerKcal, weightKg, opts = {}) {
  const sport = oneOf((opts.sport || 'mixed').toLowerCase(), ['endurance','power','mixed'], 'mixed');
  const level = clampInt(opts.level ?? 3, 1, 5);
  const goal  = oneOf((opts.goal  || 'maintain').toLowerCase(), ['loss','maintain','gain'], 'maintain');

  // --- BIAŁKO (ACSM/ISSN) ---
  const proteinMinGkg = goal === 'loss' ? 1.8 : 1.6;
  const proteinMaxGkg = goal === 'loss' ? 2.4 : 2.2;
  let protein_g = clamp(2.0 * weightKg, proteinMinGkg * weightKg, proteinMaxGkg * weightKg);

  // --- TŁUSZCZ: podłoga = max(20% kcal, 0.8 g/kg) ---
  const fatPctMin   = 0.20;
  const fatFloorGkg = 0.8;
  const fatFloor_g  = Math.max(fatFloorGkg * weightKg, (eerKcal * fatPctMin) / 9);
  let  fat_g        = fatFloor_g;

  // --- WĘGLE: zakres zależny od sportu i poziomu ---
  const load = levelToLoad(level);
  const [carbMinGkg, carbMaxGkg] = carbRangeGkg(sport, load);
  const minCarb_g = carbMinGkg * weightKg;
  const maxCarb_g = carbMaxGkg * weightKg;
  let   carbs_g   = ((carbMinGkg + carbMaxGkg) / 2) * weightKg;

  const kcal = (c,p,f)=> c*4 + p*4 + f*9;

  // Jeśli P + fat_floor > EER → zredukuj białko do swojego minimum
  if (kcal(0, protein_g, fat_g) > eerKcal) {
    protein_g = Math.max(proteinMinGkg * weightKg, (eerKcal - fat_g*9) / 4);
    protein_g = Math.max(0, protein_g);
  }

  // Węgle z reszty energii
  carbs_g = Math.max(0, (eerKcal - (protein_g*4 + fat_g*9)) / 4);

  // Trzymaj widełki węgli
  if (carbs_g > maxCarb_g) carbs_g = maxCarb_g;

  // Dobić/ściąć do celu kcal (priorytet: minCarb, potem minProtein, tłuszcz ≥ podłoga)
  let totalKcal = kcal(Math.max(carbs_g, minCarb_g), protein_g, fat_g);
  if (totalKcal < eerKcal) {
    fat_g  += (eerKcal - totalKcal) / 9;
    carbs_g = Math.max(carbs_g, minCarb_g);
  } else if (totalKcal > eerKcal) {
    const delta = totalKcal - eerKcal;
    const reducibleCarbKcal = (Math.max(carbs_g, minCarb_g) - minCarb_g) * 4;
    if (reducibleCarbKcal >= delta) {
      carbs_g = Math.max(carbs_g, minCarb_g) - (delta / 4);
    } else {
      carbs_g = minCarb_g;
      const remain = delta - reducibleCarbKcal;
      const reducibleProteinKcal = (protein_g - proteinMinGkg*weightKg) * 4;
      if (reducibleProteinKcal >= remain) {
        protein_g -= remain / 4;
      } else {
        protein_g = proteinMinGkg*weightKg;
        const rest = remain - reducibleProteinKcal;
        carbs_g = Math.max(0, carbs_g - (rest / 4));
      }
    }
  }

  // Nigdy poniżej podłogi tłuszczu
  if (fat_g < fatFloor_g) fat_g = fatFloor_g;

  // Zaokrąglenia
  carbs_g   = round1(Math.max(0, carbs_g));
  protein_g = round1(Math.max(0, protein_g));
  fat_g     = round1(Math.max(fatFloor_g, fat_g));

  return {
    kcal: Math.round(eerKcal),
    carbs_g,
    fat_g,
    protein_g,
    meta: {
      method: 'athlete_split_v1',
      sport, level, goal,
      carbRange_gkg: [carbMinGkg, carbMaxGkg],
      fat_floor: { pctMin: fatPctMin, gkgMin: fatFloorGkg }
    }
  };
}

// ===================== Pomocnicze =====================
function levelToLoad(level) {
  if (level <= 2) return 'low';
  if (level === 3) return 'moderate';
  if (level === 4) return 'high';
  return 'very_high'; // 5
}
function carbRangeGkg(sport, load) {
  // Endurance: 5–10 g/kg zwykle; 8–12 g/kg przy bardzo wysokim obciążeniu
  // Power/siła: 3–7 g/kg
  // Mixed: pośrednio (4–9 g/kg) zależnie od obciążenia
  if (sport === 'endurance') {
    if (load === 'very_high') return [8, 12];
    if (load === 'high')      return [8, 10];
    if (load === 'moderate')  return [6,  8];
    return [5, 7];
  }
  if (sport === 'power') {
    if (load === 'very_high') return [5, 7];
    if (load === 'high')      return [5, 7];
    if (load === 'moderate')  return [4, 6];
    return [3, 5];
  }
  // mixed
  if (load === 'very_high')   return [7, 9];
  if (load === 'high')        return [6, 8];
  if (load === 'moderate')    return [5, 7];
  return [4, 6];
}
const clamp  = (x,a,b)=> Math.max(a, Math.min(b, x));
const clampInt = (x,a,b)=> Math.max(a, Math.min(b, Math.round(x)));
const round1 = (x)=> Math.round(x*10)/10;
function oneOf(val, list, defVal) { return list.includes(val) ? val : defVal; }

module.exports = {
  computeEER,          // 'mifflin' (basic) | 'eer' (advanced)
  beginnerSplitKcal,   // basic: Twoje % makr
  advancedSplit,       // advanced: bezpieczne minimum tłuszczu
  advancedSplitSmart
};
