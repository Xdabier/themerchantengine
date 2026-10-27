import { TestBed } from '@angular/core/testing';
import { axe, toHaveNoViolations } from 'jest-axe';
import { provideRouter } from '@angular/router';
import { PageComponent, PageHeaderComponent, PageSectionComponent } from './page/page.component';
import { SidebarComponent, type NavGroup } from './sidebar/sidebar.component';
import { TopbarComponent } from './topbar/topbar.component';

expect.extend(toHaveNoViolations);

describe('PageHeaderComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [PageHeaderComponent] }));

  it('renders the title and optional eyebrow + description', () => {
    const fixture = TestBed.createComponent(PageHeaderComponent);
    fixture.componentRef.setInput('title', 'Orders');
    fixture.componentRef.setInput('eyebrow', 'Commerce');
    fixture.componentRef.setInput('description', 'Inbox of pending orders');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h1').textContent).toContain('Orders');
    expect(fixture.nativeElement.textContent).toContain('Commerce');
    expect(fixture.nativeElement.textContent).toContain('Inbox of pending orders');
  });

  it('omits eyebrow + description when not provided', () => {
    const fixture = TestBed.createComponent(PageHeaderComponent);
    fixture.componentRef.setInput('title', 'Settings');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelectorAll('p').length).toBe(0);
  });
});

describe('PageSectionComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [PageSectionComponent] }));

  it('renders an h2 when title is set', () => {
    const fixture = TestBed.createComponent(PageSectionComponent);
    fixture.componentRef.setInput('title', 'General');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h2').textContent).toContain('General');
  });

  it('renders a bare section when no title', () => {
    const fixture = TestBed.createComponent(PageSectionComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('h2')).toBeNull();
    expect(fixture.nativeElement.querySelector('section')).toBeTruthy();
  });
});

describe('PageComponent', () => {
  it('renders a centered content wrapper', () => {
    TestBed.configureTestingModule({ imports: [PageComponent] });
    const fixture = TestBed.createComponent(PageComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('div').className).toContain('max-w-');
  });
});

describe('SidebarComponent', () => {
  const groups: NavGroup[] = [
    {
      label: 'Commerce',
      items: [
        { label: 'Orders', to: '/orders' },
        { label: 'Products', to: '/products' },
      ],
    },
    {
      label: 'Settings',
      items: [{ label: 'General', to: '/settings' }],
    },
  ];

  beforeEach(() =>
    TestBed.configureTestingModule({
      imports: [SidebarComponent],
      providers: [
        provideRouter([
          { path: '', children: [] },
          { path: 'orders', children: [] },
          { path: 'products', children: [] },
          { path: 'settings', children: [] },
        ]),
      ],
    }),
  );

  it('renders one <a> per nav item plus the root home anchor', () => {
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('groups', groups);
    fixture.detectChanges();
    const anchors = fixture.nativeElement.querySelectorAll('a');
    // 1 home + 3 items
    expect(anchors.length).toBe(4);
  });

  it('emits navItemClicked when a nav item is clicked', () => {
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('groups', groups);
    fixture.detectChanges();
    const clicks: number[] = [];
    fixture.componentInstance.navItemClicked.subscribe(() => clicks.push(1));
    // Dispatch a cancelable click to prevent RouterLink from navigating in the test.
    const firstNavItem = fixture.nativeElement.querySelectorAll('a')[1] as HTMLAnchorElement;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true });
    event.preventDefault();
    firstNavItem.dispatchEvent(event);
    expect(clicks.length).toBe(1);
  });

  it('renders each group label', () => {
    const fixture = TestBed.createComponent(SidebarComponent);
    fixture.componentRef.setInput('groups', groups);
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain('Commerce');
    expect(fixture.nativeElement.textContent).toContain('Settings');
  });
});

describe('TopbarComponent', () => {
  beforeEach(() => TestBed.configureTestingModule({ imports: [TopbarComponent] }));

  it('emits menuToggled when hamburger clicked', () => {
    const fixture = TestBed.createComponent(TopbarComponent);
    fixture.detectChanges();
    const toggled: number[] = [];
    fixture.componentInstance.menuToggled.subscribe(() => toggled.push(1));
    const button = fixture.nativeElement.querySelector(
      '[data-testid="topbar-menu-button"]',
    ) as HTMLButtonElement;
    button.click();
    expect(toggled.length).toBe(1);
  });

  it('emits searchRequested when search trigger clicked', () => {
    const fixture = TestBed.createComponent(TopbarComponent);
    fixture.detectChanges();
    const requested: number[] = [];
    fixture.componentInstance.searchRequested.subscribe(() => requested.push(1));
    const trigger = fixture.nativeElement.querySelector(
      '[data-testid="topbar-search"]',
    ) as HTMLButtonElement;
    trigger.click();
    expect(requested.length).toBe(1);
  });

  it('exposes aria-expanded reflecting mobileMenuOpen', () => {
    const fixture = TestBed.createComponent(TopbarComponent);
    fixture.detectChanges();
    let button = fixture.nativeElement.querySelector('[data-testid="topbar-menu-button"]');
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fixture.componentRef.setInput('mobileMenuOpen', true);
    fixture.detectChanges();
    button = fixture.nativeElement.querySelector('[data-testid="topbar-menu-button"]');
    expect(button.getAttribute('aria-expanded')).toBe('true');
  });

  it('renders the configurable shortcut hint', () => {
    const fixture = TestBed.createComponent(TopbarComponent);
    fixture.componentRef.setInput('searchShortcut', 'Cmd K');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="topbar-search"]').textContent,
    ).toContain('Cmd K');
  });

  describe('store identity', () => {
    function render(inputs: Record<string, unknown> = {}) {
      const fixture = TestBed.createComponent(TopbarComponent);
      for (const [name, value] of Object.entries(inputs)) {
        fixture.componentRef.setInput(name, value);
      }
      fixture.detectChanges();
      return fixture;
    }

    it('renders the store name', () => {
      const el = render({ storeName: 'Demo Store' }).nativeElement;
      expect(el.querySelector('[data-testid="topbar-store-name"]').textContent).toContain(
        'Demo Store',
      );
    });

    it('falls back to the engine label when the store has no name', () => {
      // An unnamed install must not render an empty topbar where a name goes.
      const el = render().nativeElement;
      expect(el.querySelector('[data-testid="topbar-store-name"]').textContent).toContain(
        'merchants-engine',
      );
    });

    it('renders no image when no logo URL is configured', () => {
      // The branch every seeded install takes.
      expect(
        render({ storeName: 'Demo Store' }).nativeElement.querySelector(
          '[data-testid="topbar-store-logo"]',
        ),
      ).toBeNull();
    });

    it('renders a decorative image when a logo URL is configured', () => {
      const logo = render({
        storeName: 'Demo Store',
        storeLogoUrl: '/uploads/mark.png',
      }).nativeElement.querySelector('[data-testid="topbar-store-logo"]') as HTMLImageElement;
      expect(logo).not.toBeNull();
      expect(logo.getAttribute('src')).toBe('/uploads/mark.png');
      // The name sits beside it; an announced mark would say it twice.
      expect(logo.getAttribute('alt')).toBe('');
      expect(logo.getAttribute('aria-hidden')).toBe('true');
    });

    it('keeps the store out of the admin palette', () => {
      // Constitution 3.9: the store's name and mark appear in the shell, the
      // store's colours never do.
      const identity = render({
        storeName: 'Demo Store',
        storeLogoUrl: '/uploads/mark.png',
      }).nativeElement.querySelector('[data-testid="topbar-store-identity"]') as HTMLElement;
      expect(identity.className).toContain('text-ink-muted');
      // The fixed width is what keeps a masked visual baseline independent of
      // whichever fixture's store name recorded it; a mask paints the located
      // element's bounding box, so a variable width couples every shot.
      expect(identity.className).toContain('w-56');
      expect(identity.outerHTML).not.toMatch(/#[0-9a-fA-F]{3,8}/);
    });

    it('has no axe violations with the identity rendered', async () => {
      // The route-level runs cover this markup twice over, but the primitive
      // is owed its own backstop per the admin lane testing bar (.claude/rules/admin.md).
      const fixture = render({ storeName: 'Demo Store', storeLogoUrl: '/uploads/mark.png' });
      expect(await axe(fixture.nativeElement)).toHaveNoViolations();
    });
  });
});
