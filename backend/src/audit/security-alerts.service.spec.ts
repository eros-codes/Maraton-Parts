import { ConfigService } from '@nestjs/config';
import { SecurityAlertsService } from './security-alerts.service';
import { SmsService } from '../sms/sms.service';

function setup(values: Record<string, string>) {
  const config = {
    get: (key: string) => values[key],
  } as unknown as ConfigService;
  const sendTemplate = jest.fn().mockResolvedValue({ delivered: true });
  const service = new SecurityAlertsService(config, {
    sendTemplate,
  } as unknown as SmsService);
  return { service, sendTemplate };
}

describe('SecurityAlertsService', () => {
  const fetchMock = jest.fn();
  beforeEach(() => {
    fetchMock.mockReset().mockResolvedValue({ ok: true, status: 200 });
    global.fetch = fetchMock;
  });

  it('does nothing at all when no channel is configured', async () => {
    const { service, sendTemplate } = setup({});
    await expect(service.send('admin_granted', '0912')).resolves.toBe(false);
    expect(sendTemplate).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('texts every listed number through the alert template', async () => {
    const { service, sendTemplate } = setup({
      SECURITY_ALERT_MOBILES: '09120000001, 09120000002',
      SMSIR_SECURITY_ALERT_TEMPLATE_ID: '555',
    });
    await expect(
      service.send('admin_login_locked', '09121234567'),
    ).resolves.toBe(true);
    expect(sendTemplate).toHaveBeenCalledTimes(2);
    expect(sendTemplate).toHaveBeenCalledWith('09120000001', '555', {
      EVENT: 'قفل ورود حساب ادمین',
    });
  });

  it('messages the bot (Bale by default)', async () => {
    const { service } = setup({
      ALERT_BOT_TOKEN: 'tok',
      ALERT_BOT_CHAT_ID: '42',
    });
    await service.send('admin_session_stolen', '09121234567', 'IP: 1.2.3.4');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://tapi.bale.ai/bottok/sendMessage');
    const body = JSON.parse(init.body as string) as {
      chat_id: string;
      text: string;
    };
    expect(body.chat_id).toBe('42');
    expect(body.text).toContain('سرقت احتمالی نشست ادمین');
    expect(body.text).toContain('IP: 1.2.3.4');
  });

  it('sends the same alert once per half hour, so an attack cannot flood the phone', async () => {
    const { service, sendTemplate } = setup({
      SECURITY_ALERT_MOBILES: '09120000001',
      SMSIR_SECURITY_ALERT_TEMPLATE_ID: '555',
    });
    await service.send('admin_login_locked', 'a');
    await service.send('admin_login_locked', 'a');
    await service.send('admin_login_locked', 'b');
    expect(sendTemplate).toHaveBeenCalledTimes(2);
  });

  it('never throws when the channel is down', async () => {
    fetchMock.mockRejectedValue(new Error('network down'));
    const { service } = setup({
      ALERT_BOT_TOKEN: 'tok',
      ALERT_BOT_CHAT_ID: '42',
    });
    await expect(service.send('two_factor_disabled', 'x')).resolves.toBe(false);
  });
});
