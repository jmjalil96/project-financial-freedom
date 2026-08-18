import { BrandMark } from "@/components/brand-mark";
import { OnboardingForm } from "@/features/onboarding/onboarding-form";

const monthlyRhythm = [
  {
    number: "01",
    title: "Collect",
    copy: "Prepare one clean file for each statement.",
  },
  {
    number: "02",
    title: "Reconcile",
    copy: "Resolve uncertainty before it reaches your reports.",
  },
  {
    number: "03",
    title: "Close",
    copy: "Finish with one explainable view of the month.",
  },
] as const;

export function OnboardingPage() {
  return (
    <main className="onboarding">
      <section className="onboarding__thesis">
        <div className="onboarding__brand">
          <BrandMark />
          <span>Project Financial Freedom</span>
        </div>

        <div className="onboarding__copy">
          <p className="eyebrow">Monthly, not minute-by-minute</p>
          <h1>
            One month.
            <br />
            Fully explained.
          </h1>
          <p className="onboarding__lede">
            A private ledger for understanding what changed, why it changed, and what
            deserves your attention next.
          </p>
        </div>

        <ol className="rhythm-list">
          {monthlyRhythm.map((step) => (
            <li key={step.number}>
              <span>{step.number}</span>
              <div>
                <strong>{step.title}</strong>
                <p>{step.copy}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="onboarding__setup">
        <OnboardingForm />
      </section>
    </main>
  );
}
