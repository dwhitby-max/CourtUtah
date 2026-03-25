import { Link } from "react-router-dom";

export default function TermsPage() {
  return (
    <div className="min-h-screen bg-gray-50 px-4 py-12">
      <div className="max-w-3xl mx-auto bg-white shadow rounded-lg p-8">
        <h1 className="text-3xl font-bold text-slate-800 mb-6">Terms and Conditions</h1>
        <p className="text-sm text-gray-500 mb-8">Effective Date: March 15, 2026</p>

        <div className="prose prose-slate max-w-none space-y-6 text-gray-700">
          <p>
            These Terms and Conditions ("Terms") govern your access to and use of the Court Calendar
            Tracker application (the "Service") operated by 1564 Ventures, Inc. ("Company," "we," "us,"
            or "our"). By accessing or using the Service, you agree to be bound by these Terms.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">1. Acceptance of Terms</h2>
          <p>
            By creating an account or using the Service, you acknowledge that you have read, understood,
            and agree to be bound by these Terms and our Privacy Policy. If you do not agree, you must
            not use the Service.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">2. Description of Service</h2>
          <p>
            The Service aggregates publicly available court calendar data from the Utah Courts website
            and provides tools to search, track, and sync court schedule information to your personal
            calendar. The Service also provides notifications about schedule changes.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">3. Eligibility</h2>
          <p>
            You must be at least 18 years of age and have the legal capacity to enter into a binding
            agreement to use the Service. By using the Service, you represent that you meet these
            requirements.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">4. User Accounts</h2>
          <p>
            You are responsible for maintaining the confidentiality of your account credentials and
            for all activities that occur under your account. You agree to notify us immediately of
            any unauthorized use of your account. We reserve the right to suspend or terminate accounts
            that violate these Terms.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">5. Acceptable Use</h2>
          <p>You agree not to:</p>
          <ul className="list-disc pl-6 space-y-1">
            <li>Use the Service for any unlawful purpose or in violation of any applicable laws.</li>
            <li>Attempt to interfere with, compromise, or disrupt the Service or its infrastructure.</li>
            <li>Use automated tools to scrape, harvest, or extract data from the Service beyond normal use.</li>
            <li>Impersonate another person or entity.</li>
            <li>Use the Service to harass, stalk, or intimidate any individual.</li>
            <li>Redistribute court data obtained through the Service for commercial purposes without authorization.</li>
          </ul>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">6. Court Data Disclaimer</h2>
          <p>
            The court calendar data provided through the Service is sourced from publicly available
            records on the Utah Courts website. While we strive for accuracy, we make <strong>no
            warranty or guarantee</strong> that the data is complete, current, or error-free. Court
            schedules are subject to change without notice by the courts.
          </p>
          <p>
            <strong>The Service is not a substitute for directly verifying court schedules with the
            appropriate court.</strong> You should always confirm hearing dates, times, and locations
            directly with the court. Reliance on the Service for court appearances is at your own risk.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">7. Calendar Integration</h2>
          <p>
            The Service connects to third-party calendar providers (Google, Microsoft, Apple) via
            their respective APIs. We only create, update, and delete calendar events that were
            created by the Service. We will never modify or delete calendar events that were not
            created by the Service.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">8. Intellectual Property</h2>
          <p>
            The Service, including its design, code, features, and branding, is the property of
            1564 Ventures, Inc. and is protected by applicable intellectual property laws. You are
            granted a limited, non-exclusive, non-transferable license to use the Service for its
            intended purpose.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">9. Limitation of Liability</h2>
          <p>
            To the fullest extent permitted by law, 1564 Ventures, Inc. shall not be liable for any
            indirect, incidental, special, consequential, or punitive damages, including but not
            limited to loss of profits, data, or goodwill, arising out of or in connection with your
            use of the Service.
          </p>
          <p>
            In no event shall our total liability exceed the amount paid by you, if any, for accessing
            the Service during the twelve (12) months preceding the claim.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">10. Disclaimer of Warranties</h2>
          <p>
            The Service is provided on an "AS IS" and "AS AVAILABLE" basis without warranties of any
            kind, whether express or implied, including but not limited to implied warranties of
            merchantability, fitness for a particular purpose, and non-infringement.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">11. Indemnification</h2>
          <p>
            You agree to indemnify, defend, and hold harmless 1564 Ventures, Inc. and its officers,
            directors, employees, and agents from and against any claims, liabilities, damages, losses,
            and expenses arising out of or in connection with your use of the Service or violation of
            these Terms.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">12. Subscription, Refund, and Cancellation Policy</h2>
          <p>
            The Service offers a free tier with limited access and a paid Pro subscription at $14.99 per
            month, billed monthly through Stripe. By subscribing, you authorize recurring monthly charges
            to your payment method on file.
          </p>
          <p><strong>7-Day Refund Policy:</strong> If you are not satisfied with your Pro subscription,
            you may request a full refund within seven (7) days of your initial subscription purchase.
            Refund requests must be submitted by contacting us at ops@1564hub.com. After the 7-day
            period, no refunds will be issued for the current billing month.
          </p>
          <p><strong>No Partial Refunds:</strong> Once the 7-day refund window has passed, no refunds
            will be provided for any remaining time in the current billing period. You will continue to
            have access to Pro features through the end of your paid billing cycle.
          </p>
          <p><strong>Cancellation:</strong> You may cancel your subscription at any time prior to your
            next renewal date. Cancellations can be processed through the billing management page within
            the Service or by contacting us at ops@1564hub.com. Upon cancellation, your Pro access will
            remain active until the end of your current paid billing period, after which your account
            will revert to the free tier. No further charges will be made after cancellation.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">13. Termination</h2>
          <p>
            We may terminate or suspend your access to the Service at any time, with or without cause,
            and with or without notice. Upon termination, your right to use the Service will immediately
            cease. Provisions that by their nature should survive termination shall survive.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">14. Governing Law and Jurisdiction</h2>
          <p>
            These Terms shall be governed by and construed in accordance with the laws of the State of
            Utah, without regard to its conflict of law provisions. Any legal action or proceeding arising
            under these Terms shall be brought exclusively in the courts located in Salt Lake County,
            State of Utah, and you hereby consent to the personal jurisdiction and venue of such courts.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">15. Changes to These Terms</h2>
          <p>
            We reserve the right to modify these Terms at any time. We will notify you of material
            changes by posting the updated Terms on this page and updating the "Effective Date" above.
            Your continued use of the Service after changes constitutes acceptance of the updated Terms.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">16. Severability</h2>
          <p>
            If any provision of these Terms is held to be unenforceable or invalid, such provision
            will be changed and interpreted to accomplish the objectives of such provision to the
            greatest extent possible under applicable law, and the remaining provisions will continue
            in full force and effect.
          </p>

          <h2 className="text-xl font-semibold text-slate-800 mt-8">17. Contact Us</h2>
          <p>
            If you have questions about these Terms, please contact us at:
          </p>
          <p>
            <strong>1564 Ventures, Inc.</strong><br />
            Salt Lake County, Utah<br />
            Email: legal@1564ventures.com
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
