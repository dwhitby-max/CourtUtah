import { Link } from "react-router-dom";

export default function PrivacyPolicyPage() {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="max-w-3xl mx-auto bg-white shadow rounded-lg p-8">
        <h1 className="text-3xl font-bold text-slate-800 mb-6">Privacy Policy</h1>
        <p className="text-sm text-gray-500 mb-8">Effective Date: March 15, 2026</p>

        <div className="prose prose-slate max-w-none space-y-6 text-gray-700">
          <p>
            1564 Ventures, Inc. ("Company," "we," "us," or "our") operates the Court Calendar Tracker
            application (the "Service"). This Privacy Policy explains how we collect, use, disclose,
            and safeguard your information when you use our Service.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">1. Information We Collect</h2>
          <p>We may collect the following categories of information:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Account Information:</strong> Your name, email address, and phone number provided during registration or via Google OAuth sign-in.</li>
            <li><strong>Calendar Data:</strong> Calendar connection tokens (encrypted) to sync court events to your Google, Microsoft, Apple, or CalDAV calendar.</li>
            <li><strong>Usage Data:</strong> Search queries, watched cases, notification preferences, and interaction logs.</li>
            <li><strong>Device and Access Data:</strong> IP address, browser type, operating system, and access timestamps collected automatically via server logs.</li>
          </ul>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">2. How We Use Your Information</h2>
          <p>We use the information we collect to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Provide, operate, and maintain the Service.</li>
            <li>Sync court calendar events to your connected calendars.</li>
            <li>Send notifications about schedule changes, new events, and system alerts via email, SMS, or in-app notifications based on your preferences.</li>
            <li>Improve, personalize, and expand the Service.</li>
            <li>Communicate with you for customer service, updates, and administrative purposes.</li>
            <li>Detect, prevent, and address technical issues or security threats.</li>
          </ul>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">3. Data Storage and Security</h2>
          <p>
            All OAuth tokens and sensitive credentials are encrypted using AES-256-GCM encryption at rest.
            We use industry-standard security measures including HTTPS, rate limiting, and access controls
            to protect your data. However, no method of electronic storage or transmission is 100% secure,
            and we cannot guarantee absolute security.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">4. Third-Party Services</h2>
          <p>We integrate with the following third-party services:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li><strong>Google Calendar API:</strong> To sync events to your Google Calendar.</li>
            <li><strong>Microsoft Graph API:</strong> To sync events to your Outlook calendar.</li>
            <li><strong>Apple iCloud / CalDAV:</strong> To sync events to Apple or CalDAV-compatible calendars.</li>
            <li><strong>Twilio:</strong> To send SMS notifications.</li>
            <li><strong>SendGrid / SMTP:</strong> To send email notifications.</li>
          </ul>
          <p>
            These third-party services have their own privacy policies, and we encourage you to review them.
            We only share the minimum data necessary to provide the Service.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">5. Public Court Data</h2>
          <p>
            The court calendar data displayed through the Service is publicly available information
            obtained from the Utah Courts website (legacy.utcourts.gov). We do not claim ownership
            of this data. We aggregate and present it for convenience and do not modify the substance
            of court records.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">6. Data Retention</h2>
          <p>
            We retain your account information for as long as your account is active. Court event data
            is retained to support change detection and historical search. You may request deletion of
            your account and associated data by contacting us.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">7. Your Rights</h2>
          <p>Depending on your jurisdiction, you may have the right to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Access the personal data we hold about you.</li>
            <li>Request correction of inaccurate data.</li>
            <li>Request deletion of your data.</li>
            <li>Withdraw consent for data processing.</li>
            <li>Export your data in a portable format.</li>
          </ul>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">8. Children's Privacy</h2>
          <p>
            The Service is not intended for individuals under the age of 18. We do not knowingly collect
            personal information from children.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">9. Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. We will notify you of any changes by
            posting the new Privacy Policy on this page and updating the "Effective Date" above. Your
            continued use of the Service after changes constitutes acceptance of the updated policy.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">10. Contact Us</h2>
          <p>
            If you have questions about this Privacy Policy, please contact us at:
          </p>
          <p>
            <strong>1564 Ventures, Inc.</strong><br />
            Salt Lake County, Utah<br />
            Email: privacy@1564ventures.com
          </p>
        </div>

        <div className="mt-8 pt-6 border-t border-gray-200">
          <Link to="/login" className="text-amber-700 hover:text-amber-800 font-medium">
            &larr; Back
          </Link>
        </div>
      </div>
    </div>
  );
}
