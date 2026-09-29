# MDXplora

**From question to publishable molecular dynamics.**

MDXplora prepares the system, runs the dynamics, analyses the trajectory and writes up the study, in your browser.
Every study is reproducible, traceable and checked before it runs.

[mdxplora.com](https://mdxplora.com) | [Ask for early access](https://mdxplora.com/contact/?topic=early-access) |
[info@mdxplora.com](mailto:info@mdxplora.com)

## How a study runs

One file, the **Config**, describes the whole study: the system, how it is prepared, how it is simulated, what is
measured and how it is reported. Four phases run from it:

- **Setup** fetches or reads the structure, repairs what is missing, decides what each non-standard residue is for,
  then solvates and adds ions.
- **Simulation** runs minimisation, equilibration and production, with restraints, membranes and biased sampling when
  the study asks for them.
- **Analysis** measures the trajectory and records the settings it actually used.
- **Report** writes a methods paragraph from the recorded values, and a convergence section that says what the
  trajectory can support.

A **Manifest** then records every phase, file and setting, and the software it ran on, so the study can be read, and
run again, by someone who was not there.

## Three ways to start

- **Describe it.** Say what you want in a sentence. The Agent writes the study, and it is checked before anything runs.
- **Build it.** A form with every setting visible and explained, checked as you go.
- **Bring it.** Upload a Config you already have. It runs as written.

## What you can study

- A protein on its own: fold, flexibility, secondary structure, contacts and clustering, from a PDB code.
- A protein with a ligand: the ligand's chemistry and protonation settled in the binding site, and the interactions
  that hold it.
- A membrane protein, embedded in a lipid bilayer with its orientation checked.
- Free energy along a coordinate: umbrella sampling, metadynamics and steered MD.
- A trajectory you already have, from other engines, in their own formats.
- Many systems at once: mutants against wild type, or a sweep across a setting, with one comparison report.

## It refuses rather than guesses

An ambiguous ligand charge, a protein backwards in its membrane, a free-energy surface that never converged: each stops
the run and is named, with a sentence saying what to fix. A standard error the trajectory cannot support is withheld,
not printed beside a caveat.

## Compute and data

No GPU is needed: studies run on GPUs we provide. Connecting your own workstation or cluster, and choosing for each
study where it runs, is on the way. Every study can be downloaded whole: the Config, the data, the report and the
Manifest.

## Early access

MDXplora is in early access, opening to a small number of groups first. Tell us about your systems and your compute
through the [contact form](https://mdxplora.com/contact/?topic=early-access). We also run studies for groups, train labs
and support those that depend on molecular dynamics: see [Services](https://mdxplora.com/services/).

## Privacy and security

What the website collects is set out at [mdxplora.com/privacy](https://mdxplora.com/privacy/). To report a security
problem, write to [info@mdxplora.com](mailto:info@mdxplora.com)
([security.txt](https://mdxplora.com/.well-known/security.txt)).

## This repository

The source of [mdxplora.com](https://mdxplora.com). To work on the site, see [DEVELOPMENT.md](DEVELOPMENT.md).
