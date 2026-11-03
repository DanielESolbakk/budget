import type { RecurringCommitmentPaymentCandidate } from "../../domain/types.js";

export interface RecurringCommitmentPaymentSearchEntry {
  candidate: RecurringCommitmentPaymentCandidate;
  searchText: string;
}

export interface RecurringCommitmentPaymentSearchIndex {
  hasCandidates(currencyCode: string): boolean;
  search(currencyCode: string, query: string): RecurringCommitmentPaymentCandidate[];
}

interface IndexedPaymentCandidate {
  candidate: RecurringCommitmentPaymentCandidate;
  searchText: string;
}

export function createRecurringCommitmentPaymentSearchIndex(
  entries: readonly RecurringCommitmentPaymentSearchEntry[]
): RecurringCommitmentPaymentSearchIndex {
  const indexes = new Map<string, Map<string, IndexedPaymentCandidate[]>>();

  for (const { candidate, searchText } of entries) {
    let currencyIndex = indexes.get(candidate.currencyCode);
    if (currencyIndex === undefined) {
      currencyIndex = new Map();
      indexes.set(candidate.currencyCode, currencyIndex);
    }

    const indexedCandidate = {
      candidate,
      searchText: searchText.toLowerCase(),
    };
    const candidateBigrams = new Set<string>();
    for (let index = 0; index < indexedCandidate.searchText.length - 1; index += 1) {
      candidateBigrams.add(indexedCandidate.searchText.slice(index, index + 2));
    }

    for (const bigram of candidateBigrams) {
      const matches = currencyIndex.get(bigram) ?? [];
      matches.push(indexedCandidate);
      currencyIndex.set(bigram, matches);
    }
  }

  return {
    hasCandidates(currencyCode) {
      return indexes.has(currencyCode);
    },
    search(currencyCode, query) {
      const normalizedQuery = query.trim().toLowerCase();
      if (normalizedQuery.length < 2) return [];

      const currencyIndex = indexes.get(currencyCode);
      if (currencyIndex === undefined) return [];

      let candidateSet: readonly IndexedPaymentCandidate[] | undefined;
      for (let index = 0; index < normalizedQuery.length - 1; index += 1) {
        const matches = currencyIndex.get(normalizedQuery.slice(index, index + 2));
        if (matches === undefined) return [];
        if (candidateSet === undefined || matches.length < candidateSet.length) {
          candidateSet = matches;
        }
      }

      return (candidateSet ?? [])
        .filter(({ searchText }) => searchText.includes(normalizedQuery))
        .map(({ candidate }) => candidate);
    },
  };
}
