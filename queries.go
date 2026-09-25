package main

import (
	"bufio"
	"embed"
	"fmt"
	"io/fs"
	"strings"
)

// SQL queries live in db/queries/*.sql.
// Each query starts with a "-- name: QueryName" line;
// everything up to the next "-- name:" is its text.

//go:embed db/queries/*.sql
var queriesFS embed.FS

var queries = mustLoadQueries()

// Q returns the query text by name. It panics if the query does not exist:
// that is a programmer error and shows up on the very first run.
func Q(name string) string {
	q, ok := queries[name]
	if !ok {
		panic(fmt.Sprintf("sql query %q not found in db/queries", name))
	}
	return q
}

func mustLoadQueries() map[string]string {
	out := map[string]string{}

	files, err := fs.Glob(queriesFS, "db/queries/*.sql")
	if err != nil {
		panic(err)
	}

	for _, f := range files {
		b, err := queriesFS.ReadFile(f)
		if err != nil {
			panic(err)
		}
		for name, q := range parseQueries(string(b)) {
			if _, dup := out[name]; dup {
				panic(fmt.Sprintf("%s: duplicate query name %q", f, name))
			}
			out[name] = q
		}
	}

	return out
}

func parseQueries(src string) map[string]string {
	out := map[string]string{}

	var name string
	var body strings.Builder

	flush := func() {
		if name != "" {
			out[name] = strings.TrimSpace(body.String())
		}
		body.Reset()
	}

	sc := bufio.NewScanner(strings.NewReader(src))
	for sc.Scan() {
		line := sc.Text()
		trimmed := strings.TrimSpace(line)

		if rest, ok := strings.CutPrefix(trimmed, "-- name:"); ok {
			flush()
			name = strings.TrimSpace(rest)
			continue
		}
		if name == "" || strings.HasPrefix(trimmed, "--") {
			continue // skip comments and text before the first query
		}
		body.WriteString(line)
		body.WriteByte('\n')
	}
	flush()

	return out
}
