#!/bin/bash
# Builds and runs the resume parser tests. Needs only a Swift toolchain (Xcode's, or
# swift.org's on Linux): the parser and profile model depend on Foundation alone.
set -euo pipefail
cd "$(dirname "$0")/../.."
build_dir="$(mktemp -d)"
trap 'rm -rf "$build_dir"' EXIT
swiftc -o "$build_dir/parser-tests" \
    Swiftly/Models/ApplicantProfile.swift \
    Swiftly/Resume/ResumeParser.swift \
    Swiftly/Resume/ResumeParsingResult.swift \
    tests/parser/main.swift
"$build_dir/parser-tests" tests/parser/fixtures
