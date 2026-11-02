"use client";

import React, { useEffect, useId, useRef, useState } from "react";

type Props = {
  containerRef: { current: HTMLElement | null };
  className?: string;
};

const activeClasses = ["bg-yellow-300", "text-black", "ring-2", "ring-inset", "ring-yellow-500"];

export default function FindInPage({ containerRef, className = "" }: Props) {
  const [query, setQuery] = useState("");
  const [matches, setMatches] = useState<string[]>([]);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(-1);
  const generatedId = useId().replace(/:/g, "");
  const activeElementRef = useRef<HTMLElement | null>(null);

  const clearActiveHighlight = () => {
    activeElementRef.current?.classList.remove(...activeClasses);
    activeElementRef.current = null;
  };

  useEffect(() => () => {
    activeElementRef.current?.classList.remove(...activeClasses);
  }, []);

  const activateMatch = (matchId: string, index: number) => {
    clearActiveHighlight();
    const element = document.getElementById(matchId);
    if (!element) {
      setCurrentMatchIndex(-1);
      return;
    }

    element.classList.add(...activeClasses);
    element.scrollIntoView({ behavior: "smooth", block: "center" });
    activeElementRef.current = element;
    setCurrentMatchIndex(index);
  };

  const executeSearch = () => {
    clearActiveHighlight();
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const container = containerRef.current;
    if (!normalizedQuery || !container) {
      setMatches([]);
      setCurrentMatchIndex(-1);
      return;
    }

    const rows = Array.from(container.querySelectorAll<HTMLElement>("[data-find-row]"));
    rows.forEach((row, index) => {
      row.id = `find-${generatedId}-${index}`;
    });
    const matchingIds = rows
      .filter(row => {
        const searchableText = row.dataset.searchContent || row.textContent || "";
        return searchableText.toLocaleLowerCase().includes(normalizedQuery);
      })
      .map(row => row.id);

    setMatches(matchingIds);
    if (matchingIds.length) activateMatch(matchingIds[0], 0);
    else setCurrentMatchIndex(-1);
  };

  const clearSearch = () => {
    clearActiveHighlight();
    setQuery("");
    setMatches([]);
    setCurrentMatchIndex(-1);
  };

  const navigate = (direction: "next" | "previous") => {
    if (!matches.length) return;
    const nextIndex = direction === "next"
      ? (currentMatchIndex + 1) % matches.length
      : (currentMatchIndex <= 0 ? matches.length - 1 : currentMatchIndex - 1);
    activateMatch(matches[nextIndex], nextIndex);
  };

  return (
    <div className={`flex items-center overflow-hidden rounded border border-slate-700 bg-slate-950 ${className}`}>
      <input
        type="text"
        value={query}
        onChange={event => {
          clearActiveHighlight();
          setMatches([]);
          setCurrentMatchIndex(-1);
          setQuery(event.target.value);
        }}
        onKeyDown={event => {
          if (event.key === "Enter") {
            event.preventDefault();
            executeSearch();
          }
        }}
        placeholder="Find text or item no..."
        aria-label="Find text or item number"
        className="min-w-0 w-48 bg-transparent px-3 py-2 text-sm text-slate-100 outline-none"
      />
      <button
        type="button"
        onClick={executeSearch}
        aria-label="Search"
        className="border-l border-slate-700 px-3 py-2 text-sm font-semibold text-slate-200 hover:bg-slate-800"
      >
        Search
      </button>
      <span aria-live="polite" className="border-l border-slate-700 px-2 py-2 text-xs tabular-nums text-slate-300">
        {currentMatchIndex < 0 || !matches.length ? "0 / 0" : `${currentMatchIndex + 1} / ${matches.length}`}
      </span>
      <button
        type="button"
        onClick={clearSearch}
        aria-label="Clear search"
        title="Clear search"
        className="border-l border-slate-700 px-2 py-2 text-sm font-bold text-slate-300 hover:bg-slate-800"
      >
        X
      </button>
      <button
        type="button"
        onClick={() => navigate("previous")}
        aria-label="Find previous"
        title="Find previous"
        className="border-l border-slate-700 px-2 py-2 text-sm text-slate-300 hover:bg-slate-800"
      >
        ↑
      </button>
      <button
        type="button"
        onClick={() => navigate("next")}
        aria-label="Find next"
        title="Find next"
        className="border-l border-slate-700 px-2 py-2 text-sm text-slate-300 hover:bg-slate-800"
      >
        ↓
      </button>
    </div>
  );
}
