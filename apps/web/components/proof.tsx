'use client';

import { Ban, Check, Mail, Play } from 'lucide-react';
import { useEffect, useState } from 'react';
import { ApiFailure } from '@/lib/api';
import { clock, day, usdShort as usd } from '@/lib/format';
import {
  ATTACKS,
  ENFORCERS,
  OUTCOMES,
  PRESETS,
  runProof,
  type Attack,
  type ProofResult,
  type ProofStep,
  type RecordedStory,
} from '@/lib/proof';
import { Shell } from './chrome';
import { Button, Chip, HashChip, Tag, VerdictPill } from './primitives';

const wrap = 'mx-auto w-full max-w-[1240px] px-4 lg:px-8';

function Figure({ value, caption, tone }: { value: string; caption: string; tone: string }) {
  return (
    <div className="card p-5">
      <div className={`text-[34px] leading-none font-extrabold tracking-[-0.03em] ${tone}`}>
        {value}
      </div>
      <div className="mt-2 text-[14px] font-bold">{caption}</div>
    </div>
  );
}

function Recorded({ story }: { story: RecordedStory }) {
  const paid = story.paid[0];
  return (
    <section aria-label="Recorded agent execution" className="py-12">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="gray">Recorded</Tag>
        <span className="text-muted text-[12px]">
          {day(story.recordedAt.slice(0, 10))} · a real model read the email and chose these calls ·
          not edited
        </span>
      </div>
      <h2 className="mt-3 text-[28px] leading-[1.12] font-extrabold sm:text-[32px]">
        What the agent did, as it happened
      </h2>

      <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Figure
          value={usd(paid?.cents ?? 0)}
          caption={`${usd(paid?.cents ?? 0)} paid as approved`}
          tone="text-allow"
        />
        <Figure
          value={usd(story.attackerCents)}
          caption={`${usd(story.attackerCents)} to the attacker's recipient`}
          tone="text-block"
        />
      </div>

      <ol className="card mt-3 divide-line divide-y">
        <li className="flex gap-3 p-5">
          <Check size={17} strokeWidth={2.5} className="text-allow mt-0.5 shrink-0" aria-hidden />
          <div className="min-w-0">
            <p className="text-[14px] font-bold">
              The CFO approved plan {story.branch.label}. {paid?.vendor} was paid{' '}
              {usd(paid?.cents ?? 0)}, with a receipt.
            </p>
            <p className="text-muted mt-1 text-[13px]">
              Cash went from {usd(story.cashBeforeCents)} to {usd(story.cashAfterCents)}. That
              payment was authorized, and it went through.
            </p>
          </div>
        </li>
        {story.message ? (
          <li className="flex gap-3 p-5">
            <Mail size={17} strokeWidth={1.75} className="text-muted mt-0.5 shrink-0" aria-hidden />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <Chip tone="text">UNTRUSTED INPUT</Chip>
                <span className="text-muted font-mono text-[11px] break-all">
                  {story.message.from}
                </span>
              </div>
              <p className="mt-1.5 text-[14px] font-bold">{story.message.subject}</p>
              <p className="text-muted mt-1 line-clamp-3 text-[13px] leading-relaxed">
                {story.message.body}
              </p>
            </div>
          </li>
        ) : null}
        {story.attempts.map((attempt) => (
          <li key={attempt.at + attempt.tool} className="flex gap-3 p-5">
            <Ban
              size={17}
              strokeWidth={2}
              className={`mt-0.5 shrink-0 ${attempt.enforcedBy === 'fork_mcp' ? 'text-fork-reject' : 'text-block'}`}
              aria-hidden
            />
            <div className="min-w-0">
              <p className="text-[14px] font-bold">
                The agent tried <span className="font-mono">{attempt.tool}</span>
                {attempt.amountCents ? ` for ${usd(attempt.amountCents)}` : ''}
                {attempt.recipientId ? ` to ${attempt.recipientId}` : ''}.
              </p>
              <p className="text-muted mt-1 text-[13px]">{attempt.why}</p>
              <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
                <span className="text-muted">ArmorIQ</span>
                <VerdictPill verdict={attempt.armoriq} />
                {attempt.enforcedBy ? (
                  <span className="text-muted">
                    stopped by <b className="text-text">{ENFORCERS[attempt.enforcedBy]}</b>
                  </span>
                ) : null}
                <span className="text-muted font-mono">{attempt.errorClass}</span>
                <span className="text-muted font-mono">{clock(attempt.at)}</span>
              </div>
            </div>
          </li>
        ))}
      </ol>
      <p className="text-muted mt-3 text-[12px]">
        The plan ended partially committed: the remaining approved payments did not run after the
        agent&apos;s attempt.{' '}
        {story.armorPlanId ? (
          <>
            ArmorIQ plan <span className="font-mono break-all">{story.armorPlanId}</span>.
          </>
        ) : null}
      </p>
    </section>
  );
}

function StepRow({ step, index }: { step: ProofStep; index: number }) {
  return (
    <tr
      className="border-line proof-reveal border-t align-top"
      style={{ animationDelay: `${index * 350}ms` }}
    >
      <td className="py-3 pr-4 font-mono text-[12px]">{step.tool}</td>
      <td className="py-3 pr-4">
        <VerdictPill verdict={step.armoriq} />
      </td>
      <td className="py-3 pr-4 text-[13px]">{OUTCOMES[step.outcome]}</td>
      <td className="py-3 pr-4 text-[13px]">
        {step.enforcedBy ? ENFORCERS[step.enforcedBy] : '—'}
        {step.errorClass ? (
          <div className="text-muted font-mono text-[11px]">{step.errorClass}</div>
        ) : null}
      </td>
      <td className="py-3">{step.matchedExpectation ? null : <Tag tone="gold">Unexpected</Tag>}</td>
    </tr>
  );
}

function LiveResult({ result }: { result: ProofResult }) {
  const { sandbox } = result.ledger;
  return (
    <div className="card mt-4 p-5" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="accent">Run just now</Tag>
        <span className="text-muted font-mono text-[12px]">{clock(result.ranAt)}</span>
        {result.integrity === 'failed' ? <Tag tone="bad">Integrity check failed</Tag> : null}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[560px] text-left">
          <thead>
            <tr className="label">
              <th className="pr-4 pb-2 font-bold">Call</th>
              <th className="pr-4 pb-2 font-bold">ArmorIQ decision</th>
              <th className="pr-4 pb-2 font-bold">Final outcome</th>
              <th className="pr-4 pb-2 font-bold">Enforced by</th>
              <th className="pb-2" />
            </tr>
          </thead>
          <tbody>
            {result.steps.map((step, index) => (
              <StepRow key={step.tool} step={step} index={index} />
            ))}
          </tbody>
        </table>
      </div>
      <dl className="text-muted mt-4 grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-1 text-[12px]">
        {result.capabilityCheck ? (
          <>
            <dt>Capability check</dt>
            <dd>
              approved arguments {result.capabilityCheck.originalArguments}, altered arguments{' '}
              {result.capabilityCheck.alteredArguments}. The approved payment itself was not sent.
            </dd>
          </>
        ) : null}
        <dt>Sandbox cash</dt>
        <dd>
          {usd(sandbox.cashBeforeCents)} before, {usd(sandbox.cashAfterCents)} after,{' '}
          {sandbox.postingsAdded} postings added
        </dd>
        <dt>ArmorIQ plan</dt>
        <dd className="font-mono break-all">{result.armorPlanId}</dd>
        <dt>Measured against</dt>
        <dd>
          {result.reference.vendor}, {usd(result.reference.amountCents)}, authorized by the demo
          harness, not by a person{' '}
          <HashChip value={result.reference.approvedPlanHash} label="Reference plan hash" />
        </dd>
      </dl>
    </div>
  );
}

// what a probe goes through. the engine answers once at the end, so none of these is ticked off
// while it runs. the pulse only shows the request is still in flight.
const HOPS = [
  'FORK engine',
  'ArmorIQ signs the plan',
  'ArmorIQ proxy',
  'Payment server',
  'Ledger check',
];

function InFlight() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(timer);
  }, []);
  return (
    <div className="card mt-4 p-5" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center gap-2">
        <span className="bg-accent proof-dot h-2 w-2 rounded-full" aria-hidden />
        <span className="text-[14px] font-bold">Live against ArmorIQ</span>
        <span className="text-muted font-mono text-[12px]">{seconds}s</span>
      </div>
      <ol className="mt-4 flex flex-wrap items-center gap-y-2">
        {HOPS.map((hop, index) => (
          <li key={hop} className="flex items-center">
            <span
              className="border-line proof-hop rounded-[8px] border px-3 py-1.5 text-[12px] font-bold"
              style={{ animationDelay: `${index * 300}ms` }}
            >
              {hop}
            </span>
            {index < HOPS.length - 1 ? (
              <span className="bg-line relative mx-2 h-px w-6 overflow-hidden" aria-hidden>
                <span
                  className="bg-accent proof-wire absolute inset-y-0 w-3"
                  style={{ animationDelay: `${index * 300}ms` }}
                />
              </span>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="text-muted mt-4 text-[12px]">
        A real plan is being signed and two real calls dispatched. This usually takes a few seconds;
        the verdicts appear below as soon as ArmorIQ answers.
      </p>
    </div>
  );
}

function wait(error: unknown): string {
  if (!(error instanceof ApiFailure)) return String(error);
  const seconds = (error.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
  if (error.status === 429 && seconds)
    return `${error.message}. Try again in ${seconds} seconds. The recorded run above is unaffected.`;
  return `${error.message} The recorded run above is unaffected.`;
}

function Live() {
  const [attack, setAttack] = useState<Attack>('policy_blocked_tool');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ProofResult | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const preset = PRESETS[attack];

  async function run() {
    setBusy(true);
    setProblem(null);
    try {
      setResult(await runProof(attack));
    } catch (error) {
      setResult(null);
      setProblem(wait(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Live security probe" className="border-line border-t py-12">
      <div className="flex flex-wrap items-center gap-2">
        <Tag tone="accent">Live</Tag>
        <span className="text-muted text-[12px]">A scripted probe, not an agent</span>
      </div>
      <h2 className="mt-3 text-[28px] leading-[1.12] font-extrabold sm:text-[32px]">
        Now run the check yourself
      </h2>
      <p className="text-muted mt-3 max-w-[68ch] text-[14px] leading-[1.8]">
        The call is fixed in advance; the enforcement is live. Each run first makes a governed
        balance read that ArmorIQ should allow, then the attempt you pick. It runs against a
        separate sandbox ledger and can never move money.
      </p>

      <fieldset className="mt-5 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <legend className="sr-only">Attempt to run</legend>
        {ATTACKS.map((item) => (
          <label
            key={item}
            className={`card flex cursor-pointer items-center gap-2.5 p-4 text-[14px] font-bold ${item === attack ? 'border-accent shadow-[inset_0_0_0_1px_var(--accent)]' : ''}`}
          >
            <input
              type="radio"
              name="attack"
              checked={item === attack}
              onChange={() => setAttack(item)}
            />
            {PRESETS[item].name}
          </label>
        ))}
      </fieldset>
      <div className="card mt-2 p-5">
        <p className="text-[14px]">
          <b>Sends:</b> {preset.sends}
        </p>
        <p className="text-muted mt-1.5 text-[13px]">
          <b>Should happen:</b> {preset.expect}
        </p>
        <Button variant="primary" className="mt-4" disabled={busy} onClick={() => void run()}>
          <Play size={14} strokeWidth={2.25} aria-hidden /> {busy ? 'Running…' : 'Run it now'}
        </Button>
      </div>

      {problem ? (
        <p role="alert" className="card text-block mt-4 p-4 text-[13px] font-bold">
          {problem}
        </p>
      ) : null}
      {busy ? <InFlight /> : result ? <LiveResult result={result} /> : null}
    </section>
  );
}

export function Proof({ story }: { story: RecordedStory }) {
  const paid = story.paid[0];
  return (
    <Shell active="Proof">
      <main className={wrap}>
        <header className="pt-14">
          <div className="eyebrow">Proof</div>
          <h1 className="mt-3 max-w-[18ch] text-[40px] leading-[1.04] font-extrabold tracking-[-0.04em] sm:text-[56px]">
            One approval. One attempted deviation.
          </h1>
          <p className="text-muted mt-5 max-w-[64ch] text-[15px] leading-[1.8]">
            A CFO approved paying {paid?.vendor} {usd(paid?.cents ?? 0)}. An email then told the
            agent to send money somewhere else, and the agent tried. The approved payment went
            through. The other one did not. Two different gates said no, and this page shows which
            was which.
          </p>
        </header>
        <Recorded story={story} />
        <Live />
      </main>
    </Shell>
  );
}
