import { provideHttpClient, withFetch } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { ADMIN_API_BASE_URL } from '../shared';
import { CampaignsService } from './campaigns.service';

const campaignFixture = {
  id: 'camp-1',
  name: 'Spring sale',
  subject: { default: 'Vente', fr: 'Vente', en: 'Sale' },
  body: { default: 'Achetez', fr: 'Achetez', en: 'Shop now' },
  segment: 'ALL_CONFIRMED',
  couponCode: null,
  status: 'DRAFT',
  kind: 'BROADCAST',
};

const subscriberFixture = {
  id: 'sub-1',
  email: 'a@b.com',
  locale: 'en',
  source: 'newsletter-footer',
  confirmedAt: '2026-06-19T00:00:00.000Z',
  unsubscribedAt: null,
};

describe('CampaignsService', () => {
  let service: CampaignsService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withFetch()),
        provideHttpClientTesting(),
        { provide: ADMIN_API_BASE_URL, useValue: '/api' },
        CampaignsService,
      ],
    });
    service = TestBed.inject(CampaignsService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('listCampaigns() forwards status + kind filters and parses {data,meta}', (done) => {
    service.listCampaigns({ status: 'SENT', kind: 'BROADCAST' }).subscribe((res) => {
      expect(res.data).toHaveLength(1);
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/campaigns');
    expect(req.request.params.get('status')).toBe('SENT');
    expect(req.request.params.get('kind')).toBe('BROADCAST');
    req.flush({ data: [campaignFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('getCampaign() unwraps the envelope', (done) => {
    service.getCampaign('camp-1').subscribe((c) => {
      expect(c.name).toBe('Spring sale');
      done();
    });
    http.expectOne('/api/v1/admin/campaigns/camp-1').flush({ data: campaignFixture });
  });

  it('createCampaign() POSTs and returns the created campaign', (done) => {
    service
      .createCampaign({
        name: 'x',
        subject: { en: 's' },
        body: { en: 'b' },
        segment: 'ALL_CONFIRMED',
      })
      .subscribe((c) => {
        expect(c.id).toBe('camp-1');
        done();
      });
    const req = http.expectOne('/api/v1/admin/campaigns');
    expect(req.request.method).toBe('POST');
    req.flush({ data: campaignFixture });
  });

  it('updateCampaign() PATCHes', (done) => {
    service.updateCampaign('camp-1', { name: 'renamed' }).subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/campaigns/camp-1');
    expect(req.request.method).toBe('PATCH');
    req.flush({ data: campaignFixture });
  });

  it('deleteCampaign() DELETEs', (done) => {
    service.deleteCampaign('camp-1').subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/campaigns/camp-1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('sendCampaign() POSTs to /send and parses the outcome', (done) => {
    service.sendCampaign('camp-1').subscribe((res) => {
      expect(res.status).toBe('SENDING');
      done();
    });
    http
      .expectOne('/api/v1/admin/campaigns/camp-1/send')
      .flush({ data: { id: 'camp-1', status: 'SENDING' } });
  });

  it('sendTestCampaign() POSTs to /test with the locale', (done) => {
    service.sendTestCampaign('camp-1', { locale: 'fr' }).subscribe((res) => {
      expect(res.recipient).toBe('admin@x');
      done();
    });
    const req = http.expectOne('/api/v1/admin/campaigns/camp-1/test');
    expect(req.request.body).toEqual({ locale: 'fr' });
    req.flush({ data: { status: 'sent', recipient: 'admin@x' } });
  });

  it('preview() POSTs to /preview and parses whatever locales it returns', (done) => {
    service.preview('camp-1', { subject: { fr: 's' }, body: { fr: 'b' } }).subscribe((res) => {
      expect(res['en'].subject).toBe('S');
      expect(res['fr'].subject).toBe('Sujet');
      done();
    });
    http.expectOne('/api/v1/admin/campaigns/camp-1/preview').flush({
      data: {
        en: { subject: 'S', html: '<p>b</p>', text: 'b' },
        fr: { subject: 'Sujet', html: '<p>b</p>', text: 'b' },
      },
    });
  });

  it('preview() rejects a malformed locale entry via Zod', (done) => {
    // The key set is the renderer's business and moves at D7. The VALUE shape
    // is not: an entry missing `text` is still a parse failure.
    service.preview('camp-1', { body: { default: 'b' } }).subscribe({
      next: () => done(new Error('should have errored')),
      error: () => done(),
    });
    http
      .expectOne('/api/v1/admin/campaigns/camp-1/preview')
      .flush({ data: { en: { subject: 'S', html: '<p>b</p>' } } });
  });

  it('campaignStats() parses the status→count record', (done) => {
    service.campaignStats('camp-1').subscribe((stats) => {
      expect(stats['sent']).toBe(8);
      done();
    });
    http.expectOne('/api/v1/admin/campaigns/camp-1/stats').flush({ data: { total: 8, sent: 8 } });
  });

  it('listSubscribers() forwards status filter', (done) => {
    service.listSubscribers({ status: 'confirmed' }).subscribe((res) => {
      expect(res.data).toHaveLength(1);
      done();
    });
    const req = http.expectOne((r) => r.url === '/api/v1/admin/subscribers');
    expect(req.request.params.get('status')).toBe('confirmed');
    req.flush({ data: [subscriberFixture], meta: { page: 1, pageSize: 20, total: 1 } });
  });

  it('updateSubscriber() PATCHes the unsubscribed flag', (done) => {
    service.updateSubscriber('sub-1', { unsubscribed: true }).subscribe(() => done());
    const req = http.expectOne('/api/v1/admin/subscribers/sub-1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ unsubscribed: true });
    req.flush({ data: subscriberFixture });
  });
});
