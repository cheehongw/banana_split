// First-run onboarding tips: a localStorage flag so we show them once, with a
// "Show tutorial again" reset in settings.
const KEY = 'bs_tutorial_seen';

export function tutorialSeen(): boolean {
  return localStorage.getItem(KEY) === '1';
}

export function markTutorialSeen(): void {
  localStorage.setItem(KEY, '1');
}

export function resetTutorial(): void {
  localStorage.removeItem(KEY);
}
