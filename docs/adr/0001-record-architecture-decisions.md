# 1. Record architecture decisions

## Status

Accepted

## Context

longcord is a small project that runs code on people's computers. Decisions about
networking, authentication and permissions have security consequences that are easy to
undo by accident if the reasoning behind them is lost. Contributors also need to
understand why things are the way they are before changing them.

## Decision

We record significant decisions as Architecture Decision Records in `docs/adr/`, one
Markdown file per decision, numbered in order. Each record has the sections Status,
Context, Decision and Consequences.

A record is not rewritten once accepted. When a decision changes, a new record supersedes
the old one, and the old one's status says so.

## Consequences

- Pull requests that change one of these decisions should add a new ADR.
- The records are short and written for future contributors, not as a design specification.
- The [index](README.md) lists all records.
