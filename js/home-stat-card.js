// Navigation only. Counts and publication permissions come from the dashboard.
export function renderHomeStatCard({icon,label,value,hint='',view='activity',en=false,escape}) {
 return `<button type="button" class="home-stat-card" data-home-nav="${escape(view)}">
  <span class="material-icons" aria-hidden="true">${escape(icon)}</span>
  <span class="home-stat-content"><strong>${escape(value)}</strong><span>${escape(label)}</span>
  ${hint?`<small>${escape(hint)}</small>`:''}<span class="home-stat-link">${en?'View details →':'一覧を見る →'}</span></span></button>`;
}
