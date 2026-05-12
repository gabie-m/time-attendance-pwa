import { Icon } from './Icon';

export function PlatformNotice() {
  return (
    <aside className="platform-notice" aria-label="PWA platform limitations">
      <div>
        <Icon name="sync" />
        <span>Offline records sync when you reopen the app with internet.</span>
      </div>
      <div>
        <Icon name="bell" />
        <span>Add to Home Screen to enable push notifications.</span>
      </div>
    </aside>
  );
}
