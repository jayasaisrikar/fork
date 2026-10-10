import {
  BranchProposalSchema,
  openCents,
  vendorOf,
  type BranchProposal,
  type TreasuryState,
} from '@fork/domain-finance';
import { generateObject, type LanguageModel } from 'ai';

const SYSTEM = `You are the treasury planner for a small company that cannot pay every bill this week.
Propose up to three meaningfully different branches. Each branch lists, for every open invoice,
how many cents to pay now (0 = defer). Use only the invoices and vendors given. Never pay more
than an invoice's amount. Do not compute balances or fees; the simulator does that. For each
branch give a title (max 6 words) and a two-sentence rationale for a CFO. Return JSON only.
Example: {"branches":[{"title":"Preserve runway","rationale":"Pays the critical vendors in full. Defers the two largest invoices and accepts their late fees.","allocations":[{"invoiceId":"INV-01","payCents":400000},{"invoiceId":"INV-02","payCents":0}]}]}`;

const MAX_ATTEMPTS = 3;

export interface PlannerInput {
  state: TreasuryState;
  // set on a replan: what went wrong, and that one branch is enough
  replan?: string;
}

export class PlannerError extends Error {
  constructor(readonly problems: string[]) {
    super(`The planner did not produce a usable proposal: ${problems.join('; ')}`);
    this.name = 'PlannerError';
  }
}

function describe({ state, replan }: PlannerInput): string {
  const invoices = state.invoices
    .filter((invoice) => openCents(invoice) > 0)
    .map((invoice) => ({
      invoiceId: invoice.id,
      vendor: vendorOf(state, invoice)?.name,
      openCents: openCents(invoice),
      dueDate: invoice.dueDate,
      criticality: invoice.criticality,
      lateFee: invoice.lateFee,
      note: invoice.note,
    }));
  const books = {
    today: state.today,
    cashCents: state.cashCents,
    minimumReserveCents: state.reserveCents,
    invoices,
  };
  const ask = replan
    ? `An earlier branch could not be completed: ${replan}\nPropose exactly one branch for the invoices still open.`
    : 'Propose the branches.';
  return `${JSON.stringify(books)}\n\n${ask}`;
}

// the model only proposes. check() is the harness saying what is wrong, and that goes back to the model.
export async function proposeBranches(
  model: LanguageModel,
  input: PlannerInput,
  check: (proposal: BranchProposal) => string[],
): Promise<BranchProposal> {
  let problems: string[] = [];
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    const feedback = problems.length
      ? `\n\nYour last answer was rejected: ${problems.join('; ')}. Fix exactly that and answer again.`
      : '';
    try {
      const { object } = await generateObject({
        model,
        schema: BranchProposalSchema,
        system: SYSTEM,
        prompt: describe(input) + feedback,
        maxRetries: 1,
      });
      const proposal = input.replan ? { branches: object.branches.slice(0, 1) } : object;
      problems = check(proposal);
      if (problems.length === 0) return proposal;
    } catch (error) {
      problems = [error instanceof Error ? error.message.slice(0, 400) : String(error)];
    }
  }
  throw new PlannerError(problems);
}
