import React, { useEffect, useState } from 'react';
import { api } from '../api.js';

const SECTIONS = [
  { key: 'start', label: 'Getting started' },
  { key: 'training', label: 'Training guide' },
  { key: 'website', label: 'Website & domain' },
  { key: 'roles', label: 'Roles & security' },
  { key: 'install', label: 'Install the app' },
  { key: 'licence', label: 'Licensing' }
];

const TRAINING = [
  {
    title: 'Day 1 · Before your first guest',
    steps: [
      'Sign in and open Settings: confirm property name, address, phone, email, currency and check-in / check-out times.',
      'Open Rooms & housekeeping and confirm every apartment and room with its rate and section (serviced or hotel).',
      'Open Website and upload the hero photo and at least four gallery photos, then review the room photos and amenities.',
      'Open Calendar and check today’s arrivals and departures so nothing is double booked.',
      'Print a test folio from any reservation to confirm the printer and naira formatting.'
    ]
  },
  {
    title: 'Every shift',
    steps: [
      'Start a shift from the top bar and enter the opening float (cash in the drawer).',
      'Work the Front desk: check in arrivals, take payments, add extras to the folio.',
      'At handover, open Shifts & cash-up, count the drawer and end the shift. PCH PMS shows the variance instantly.',
      'Download the shift PDF and file it with the cash envelope.'
    ]
  },
  {
    title: 'Reservations & channels',
    steps: [
      'Take direct bookings on the Front desk screen or let guests book on your website — both land in the same calendar.',
      'In Channel manager, paste each OTA iCal link (Booking.com, Airbnb, Expedia) against the right room.',
      'Press Sync to pull new reservations and push your own availability calendar out.',
      'Resolve any conflicts the calendar flags before the guest arrives.'
    ]
  },
  {
    title: 'Month end',
    steps: [
      'Open Reporting, choose Last month and review occupancy, ADR, RevPAR and channel production.',
      'Download the CSV for your accountant and the PDF for your records.',
      'Compare cash collected against bank deposits using Payments by method.',
      'Review roles every quarter: remove access for staff who have left.'
    ]
  }
];

export default function Help() {
  const [tab, setTab] = useState('start');
  const [licence, setLicence] = useState(null);
  const [installReady, setInstallReady] = useState(Boolean(window.__pchInstallPrompt));
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    api.get('/licence').then((data) => setLicence(data)).catch(() => setLicence(null));
    const onPrompt = () => setInstallReady(true);
    const onInstalled = () => {
      setInstalled(true);
      setInstallReady(false);
    };
    window.addEventListener('pch-install-available', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    if (window.matchMedia('(display-mode: standalone)').matches) setInstalled(true);
    return () => {
      window.removeEventListener('pch-install-available', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  const install = async () => {
    const prompt = window.__pchInstallPrompt;
    if (!prompt) return;
    prompt.prompt();
    try {
      await prompt.userChoice;
    } finally {
      window.__pchInstallPrompt = null;
      setInstallReady(false);
    }
  };

  return (
    <div className="page page-wide">
      <div className="page-head">
        <div>
          <h2 className="page-title">Help & training</h2>
          <p className="muted small">Documentation for PCH PMS, written for hotel teams.</p>
        </div>
        <div className="page-head-actions">
          <button type="button" className="btn primary" disabled={!installReady} onClick={install}>
            {installed ? 'Installed' : installReady ? 'Install app' : 'Install via browser menu'}
          </button>
        </div>
      </div>

      <div className="tabs">
        {SECTIONS.map((section) => (
          <button
            key={section.key}
            type="button"
            className={`tab compact${tab === section.key ? ' active' : ''}`}
            onClick={() => setTab(section.key)}
          >
            <strong>{section.label}</strong>
          </button>
        ))}
      </div>

      {tab === 'start' ? (
        <div className="split-grid">
          <section className="card">
            <h3>What PCH PMS does</h3>
            <p className="muted small">
              PCH PMS is a property management system licensed to hotels, apartments and serviced residences. This
              installation is configured for <strong>Richgates Apartments</strong>: eight units across a serviced apartment
              section and a hotel room section, priced in naira.
            </p>
            <ul className="doc-list">
              <li>
                <strong>Front desk</strong> — check-in, check-out, walk-ins, folios, payments and printed registration cards.
              </li>
              <li>
                <strong>Calendar</strong> — every booking, channel block and closure on one grid.
              </li>
              <li>
                <strong>Channel manager</strong> — iCal import and export so OTAs never oversell you.
              </li>
              <li>
                <strong>Booking website</strong> — a direct-booking site at <span className="mono">/book</span> that reads live
                availability.
              </li>
              <li>
                <strong>Shifts & cash-up</strong> — floats, cash variance and printable shift reports.
              </li>
              <li>
                <strong>Reporting</strong> — occupancy, ADR, RevPAR and channel production with CSV and PDF exports.
              </li>
            </ul>
          </section>
          <section className="card">
            <h3>Quick answers</h3>
            <div className="faq">
              <details>
                <summary>How do I add a room?</summary>
                <p>Rooms & housekeeping → Add room. Choose the room type, floor and number, then set its status.</p>
              </details>
              <details>
                <summary>How do I change a rate?</summary>
                <p>Rooms & housekeeping → edit the room type → rate per night. The website and new bookings use the new rate.</p>
              </details>
              <details>
                <summary>Why does a room show as sold out?</summary>
                <p>The calendar has a reservation or channel block covering those nights. Open Calendar to see it.</p>
              </details>
              <details>
                <summary>How do I take a card payment at the desk?</summary>
                <p>Open the reservation folio and add a payment with method card. Website card payments are configured under Website → Domain & payments.</p>
              </details>
              <details>
                <summary>Who can see revenue?</summary>
                <p>Only roles with the Reporting permission. Configure this in Roles & permissions.</p>
              </details>
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'training' ? (
        <div className="stack">
          <p className="muted small">
            Work through these four sessions with each new team member. Each one takes about 20 minutes on a test booking.
          </p>
          {TRAINING.map((module) => (
            <section className="card" key={module.title}>
              <h3>{module.title}</h3>
              <ol className="training-steps">
                {module.steps.map((step) => (
                  <li key={step}>{step}</li>
                ))}
              </ol>
            </section>
          ))}
          <section className="card">
            <h3>Practice checklist</h3>
            <div className="checklist">
              {[
                'Create a test booking for tomorrow and check it in',
                'Add a minibar charge and print the folio',
                'Take a part payment and confirm the balance updates',
                'Move the booking to another room from the calendar',
                'End the shift and read the variance',
                'Download the daily report as CSV and PDF'
              ].map((item) => (
                <label key={item}>
                  <input type="checkbox" /> <span>{item}</span>
                </label>
              ))}
            </div>
          </section>
        </div>
      ) : null}

      {tab === 'website' ? (
        <div className="split-grid">
          <section className="card">
            <h3>Editing the website</h3>
            <ol className="training-steps">
              <li>Open Website → Brand & copy to set the headline, sub-text, about paragraph and notice bar.</li>
              <li>Use Images to upload a hero photo and gallery photos straight from your phone or laptop.</li>
              <li>Open Rooms & amenities to change each room photo, amenities, bed type, size and rate.</li>
              <li>Press Publish. Guests see the change immediately at <span className="mono">/book</span>.</li>
            </ol>
            <p className="muted small">
              Uploads are stored inside PCH PMS, so there is no separate file host to manage. Images up to 6 MB; PNG, JPEG,
              WebP, GIF, AVIF and SVG are accepted.
            </p>
          </section>
          <section className="card">
            <h3>Using your own domain</h3>
            <ol className="training-steps">
              <li>Choose a hostname such as <span className="mono">bookings.richgates.com</span>.</li>
              <li>Record it under Website → Domain & payments.</li>
              <li>Create a CNAME record at your DNS provider pointing that hostname at your app host.</li>
              <li>Ask your hosting provider to issue the certificate once DNS resolves.</li>
            </ol>
            <p className="muted small">
              Custom domains are a paid hosting feature. On the current plan the site runs on the free app address and staff
              keep using the same sign-in.
            </p>
          </section>
        </div>
      ) : null}

      {tab === 'roles' ? (
        <section className="card">
          <h3>Roles & security</h3>
          <ol className="training-steps">
            <li>Property admins create accounts in Staff accounts and set a temporary password.</li>
            <li>Open Roles & permissions to build a role, tick the pages it may open and choose its access level.</li>
            <li>Assign the role from the Staff assignments table — it applies on the person’s next page load.</li>
            <li>Deactivate an account the moment someone leaves; never share a login between staff.</li>
            <li>Start and end shifts so every payment is tied to the person who took it.</li>
          </ol>
          <div className="callout">
            <strong>Good practice</strong>
            <p className="muted small">
              Keep admin access to two people. Give housekeeping only the room board. Review the audit trail in Settings
              every week.
            </p>
          </div>
        </section>
      ) : null}

      {tab === 'install' ? (
        <div className="split-grid">
          <section className="card">
            <h3>Install on a phone or tablet</h3>
            <ol className="training-steps">
              <li>
                <strong>Android / Chrome:</strong> open the menu (⋮) and choose “Install app” or “Add to Home screen”.
              </li>
              <li>
                <strong>iPhone / Safari:</strong> tap Share, then “Add to Home Screen”.
              </li>
              <li>
                <strong>Desktop Chrome or Edge:</strong> click the install icon in the address bar.
              </li>
            </ol>
            <p className="muted small">
              The app opens full screen with the PCH icon, remembers your session and keeps working when the signal drops —
              data syncs when you are back online.
            </p>
            <button type="button" className="btn primary" disabled={!installReady} onClick={install}>
              {installed ? 'Already installed' : installReady ? 'Install now' : 'Use the browser menu to install'}
            </button>
          </section>
          <section className="card">
            <h3>Supported devices</h3>
            <ul className="doc-list">
              <li>Android 9+ with Chrome</li>
              <li>iPhone and iPad with iOS 16.4+ Safari</li>
              <li>Windows and macOS with Chrome or Edge</li>
              <li>Any modern browser for desk use — no installation needed</li>
            </ul>
          </section>
        </div>
      ) : null}

      {tab === 'licence' ? (
        <div className="split-grid">
          <section className="card">
            <h3>Licensing</h3>
            <table className="data-table">
              <tbody>
                <tr>
                  <th>Product</th>
                  <td>{licence?.product || 'PCH PMS'}</td>
                </tr>
                <tr>
                  <th>Vendor</th>
                  <td>{licence?.vendor || 'PCH Hospitality Systems'}</td>
                </tr>
                <tr>
                  <th>Edition</th>
                  <td>{licence?.edition || 'Multi-property licence'}</td>
                </tr>
                <tr>
                  <th>This property</th>
                  <td>{licence?.tenant || 'Richgates Apartments'}</td>
                </tr>
                <tr>
                  <th>Properties allowed</th>
                  <td>{licence?.properties_allowed ?? 5}</td>
                </tr>
                <tr>
                  <th>Support</th>
                  <td>{licence?.support_email || 'support@pchpms.com'}</td>
                </tr>
              </tbody>
            </table>
          </section>
          <section className="card">
            <h3>Adding another property</h3>
            <p className="muted small">
              PCH PMS is licensed per group, and each property is a configuration: its own rooms, rates, website, staff,
              roles and domain. This installation is configured for Richgates Apartments.
            </p>
            <p className="muted small">
              To onboard a second hotel, duplicate the configuration pattern — property details, room types with sections,
              website copy and photos, staff accounts and roles — then point that property’s domain at its own deployment.
              Contact your PCH account manager for a licence key per property.
            </p>
          </section>
        </div>
      ) : null}
    </div>
  );
}
