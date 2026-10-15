/* Zoomy for Home Assistant: the browser side. Loaded as a module on every Home Assistant page (frontend.py:
   add_extra_js_url), from /zoomy_static/<integration version>/, so a new version always gets fresh files.

   It defines the ZOOMY dashboard strategy (custom:zoomy) and the six Zoomy cards, and offers "Zoomy" in
   Settings > Dashboards > Add dashboard. It only defines elements here: nothing is asked of Home Assistant until a
   Zoomy card is on screen. */

import { ZoomyDashboardStrategy } from './strategy.js';
import './summary.js';
import './charts.js';
import './trip-map.js';
import './performance.js';
import './charge-sheet.js';

// ll-strategy-dashboard-<name> is the tag Home Assistant looks for (frontend src/panels/lovelace/strategies/get-strategy.ts)
if (!customElements.get('ll-strategy-dashboard-zoomy')) customElements.define('ll-strategy-dashboard-zoomy', ZoomyDashboardStrategy);

// the Add dashboard dialog lists window.customStrategies (frontend src/data/lovelace_custom_strategies.ts)
window.customStrategies = window.customStrategies || [];
if (!window.customStrategies.some(function (s) { return s && s.type === 'zoomy' && s.strategyType === 'dashboard'; })) {
  window.customStrategies.push({
    type: 'zoomy',
    name: 'Zoomy',
    description: 'Your Zoomy car: trips, charges, trip map, performance and charge sheet.',
    strategyType: 'dashboard'
  });
}

