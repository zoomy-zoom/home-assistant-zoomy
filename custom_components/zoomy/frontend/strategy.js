/* The ZOOMY dashboard, as a dashboard strategy (type custom:zoomy, element ll-strategy-dashboard-zoomy).

   The integration adds a storage dashboard whose whole saved config is {"strategy": {"type": "custom:zoomy"}}
   (dashboard.py). Home Assistant asks this strategy for the views each time the dashboard is opened, so the views
   always match the installed version of the integration and nothing stored ever needs rewriting. A customer can
   still "take control" of it in the dashboard editor to change it by hand.

   Six tabs, each a panel view with one Zoomy card. The views have titles and no icons (a view with an icon shows
   only the icon in the tab bar). With two or more cars every card shows a car picker; strategy option entry_id
   ({"strategy": {"type": "custom:zoomy", "entry_id": "..."}}) makes a dashboard for one car only. */

export const VIEWS = [
  { title: 'Summary', path: 'summary', card: 'zoomy-summary-card', extra: { map_view: 'map' } },
  { title: 'Trips', path: 'trips', card: 'zoomy-trips-card' },
  { title: 'Charges', path: 'charges', card: 'zoomy-charges-card' },
  { title: 'Trip map', path: 'map', card: 'zoomy-route-map-card' },
  { title: 'Performance', path: 'dyno', card: 'zoomy-performance-card' },
  { title: 'Charge sheet', path: 'charge-sheet', card: 'zoomy-charge-sheet-card' }
];

export function zoomyViews(config) {
  var fixed = config && typeof config.entry_id === 'string' && /^[A-Za-z0-9_-]{1,64}$/.test(config.entry_id) ? { entry_id: config.entry_id } : {};
  return VIEWS.map(function (v) {
    return { title: v.title, path: v.path, type: 'panel',
             cards: [Object.assign({ type: 'custom:' + v.card }, fixed, v.extra || {})] };
  });
}

export class ZoomyDashboardStrategy extends HTMLElement {
  // config: the strategy config ({type: "custom:zoomy", entry_id?}); hass is not needed (the cards find the cars)
  static async generate(config) {
    return { views: zoomyViews(config) };
  }
  // the views do not depend on the entity, device or area registries: no need to build them again when those change
  static get registryDependencies() { return []; }
  // what Settings > Dashboards > Add dashboard > Zoomy fills in
  static getCreateSuggestions() { return { title: 'ZOOMY', icon: 'mdi:car-electric' }; }
}
