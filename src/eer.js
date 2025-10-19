// /backend/eer.js  (CommonJS)
function computeEER({ sex, age, heightCm, weightKg, activity }) {
  if (!(sex === 'female' || sex === 'male')) throw new Error('Bad sex');
  const h_m = heightCm / 100;
  const PA = (sex === 'female')
    ? ({1:1.00,2:1.12,3:1.20,4:1.27,5:1.45})[activity]
    : ({1:1.00,2:1.11,3:1.18,4:1.25,5:1.48})[activity];
  const eer = (sex === 'male')
    ? 662 - 9.53*age + PA*(15.91*weightKg + 539.6*h_m)
    : 354 - 6.91*age + PA*( 9.36*weightKg + 726.0*h_m);
  return { eerKcal: Math.round(eer), pa: PA };
}

function beginnerSplitKcal(eerKcal) {
  const pct = { carbs: 0.5238, fat: 0.2619, protein: 0.2143 }; // ~52.4/26.2/21.4
  return {
    kcal: eerKcal,
    carbs_g: +(eerKcal * pct.carbs / 4).toFixed(1),
    fat_g:   +(eerKcal * pct.fat   / 9).toFixed(1),
    protein_g:+(eerKcal * pct.protein/4).toFixed(1),
    meta: { basis: 'DRI% (normalized midpoints): C~52.4% F~26.2% P~21.4%' }
  };
}

function advancedSplit(eerKcal, weightKg) {
  const protein_g = 2.0 * weightKg;
  const carbs_g   = 10.0 * weightKg;
  const fat_g     = Math.max(0, (eerKcal - (protein_g*4 + carbs_g*4)) / 9);
  return {
    kcal: eerKcal,
    carbs_g: +carbs_g.toFixed(1),
    fat_g:   +fat_g.toFixed(1),
    protein_g:+protein_g.toFixed(1),
    meta: { basis: 'Upper-bound g/kg: carbs 10, protein 2' }
  };
}

module.exports = { computeEER, beginnerSplitKcal, advancedSplit };
