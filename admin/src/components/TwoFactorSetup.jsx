import { useEffect, useState } from 'react';
import QRCode from 'qrcode';

// The QR code an authenticator app scans, with the secret underneath for
// typing in by hand. Drawn here, in the browser: the secret never goes to
// a QR service on the internet.
export function TwoFactorQr({ otpauthUrl, secret }) {
  const [dataUrl, setDataUrl] = useState('');

  useEffect(() => {
    let cancelled = false;
    QRCode.toDataURL(otpauthUrl, { margin: 1, width: 196, errorCorrectionLevel: 'M' })
      .then((url) => {
        if (!cancelled) setDataUrl(url);
      })
      .catch(() => setDataUrl(''));
    return () => {
      cancelled = true;
    };
  }, [otpauthUrl]);

  // In groups of four, as the apps show it, so it can be read out and typed.
  const grouped = secret.replace(/(.{4})/g, '$1 ').trim();

  return (
    <div className="stack" style={{ alignItems: 'center', gap: 8 }}>
      {dataUrl ? (
        <img
          src={dataUrl}
          alt="کد QR برای برنامهٔ احراز هویت"
          width="196"
          height="196"
          style={{ borderRadius: 10, border: '1px solid var(--line)', background: '#fff' }}
        />
      ) : (
        <div style={{ width: 196, height: 196 }} />
      )}
      <div className="tiny muted">اگر اسکن نشد، این کلید را دستی وارد کنید:</div>
      <code
        dir="ltr"
        className="small"
        style={{
          padding: '6px 10px',
          borderRadius: 8,
          background: 'var(--surface-2)',
          letterSpacing: 1,
          userSelect: 'all',
        }}
      >
        {grouped}
      </code>
    </div>
  );
}

// Six digits, Persian or Latin, nothing else.
export function CodeInput({ value, onChange, autoFocus = true }) {
  return (
    <input
      className="input"
      dir="ltr"
      inputMode="numeric"
      autoComplete="one-time-code"
      maxLength={6}
      placeholder="••••••"
      autoFocus={autoFocus}
      style={{ textAlign: 'center', letterSpacing: 6, fontSize: 20 }}
      value={value}
      onChange={(event) =>
        onChange(
          event.target.value
            .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
            .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)))
            .replace(/\D/g, '')
            .slice(0, 6),
        )
      }
      required
    />
  );
}

export const AUTHENTICATOR_HINT = 'مثلاً Google Authenticator یا Microsoft Authenticator';
