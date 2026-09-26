const selectedTerms = new Map();

// Use these IDs for gene matching.
function getSelectedHpoIds() {
    return [...selectedTerms.keys()];
}

function addTerm(term) {
    if (selectedTerms.has(term.hpo_id)) return;

    selectedTerms.set(term.hpo_id, term.hpo_name);

    const tag = $("<span>", {
        class: "badge bg-success-subtle text-success d-inline-flex align-items-center m-1",
        title: term.hpo_id
    });

    $("<span>", {
        class: "text-wrap text-start",
        text: term.hpo_name
    }).appendTo(tag);

    $("<button>", {
        type: "button",
        class: "btn-close btn-close-success ms-2",
        "aria-label": `Remove ${term.hpo_name}`
    }).on("click", function () {
        selectedTerms.delete(term.hpo_id);
        tag.remove();

        // Update results after removing a term.
        updateMatches();

        document.getElementById("search-input")
            .dispatchEvent(new Event("input"));
    }).appendTo(tag);

    $("#selected-terms").append(tag);

    // Update results after adding a term.
    updateMatches();
}

async function initTermSearch() {
    const response = await fetch("/static/data/hpo_terms.json");

    if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
    }

    const terms = await response.json();
    const input = document.getElementById("search-input");
    const exact = document.getElementById("exact-match");

    const autocomplete = new autoComplete({
        selector: "#search-input",
        debounce: 150,
        query: value => value.trim(),

        data: {
            src: terms,
            keys: ["name", "hpo_id"],

            // Hide selected terms and duplicate IDs.
            filter: results => {
                const seen = new Set();

                return results.filter(result => {
                    const id = result.value.hpo_id;

                    if (selectedTerms.has(id) || seen.has(id)) {
                        return false;
                    }

                    seen.add(id);
                    return true;
                });
            }
        },

        searchEngine: (query, record) => {
            query = query.toLowerCase();
            record = record.toLowerCase();

            return exact.checked
                ? record === query
                : record.includes(query);
        },

        resultsList: {
            maxResults: Infinity,
            class: "list-unstyled position-absolute top-100 start-0 w-100 shadow mt-1 bg-white rounded-3",
            element: list => {
                list.style.cssText =
                    "max-height: 38vh; overflow-y: auto; z-index: 1050;";
            }
        },

        resultItem: {
            class: "list-group-item list-group-item-action",
            selected: "active",

            element: (item, result) => {
                const term = result.value;
                const text = `${term.name} — ${term.hpo_id}`;
                const query = input.value.trim();
                const position = text.toLowerCase().indexOf(query.toLowerCase());

                item.replaceChildren();

                if (position === -1) {
                    item.textContent = text;
                    return;
                }

                const mark = document.createElement("mark");
                mark.className = "bg-success-subtle text-success p-0";
                mark.textContent = text.slice(position, position + query.length);

                item.append(
                    document.createTextNode(text.slice(0, position)),
                    mark,
                    document.createTextNode(text.slice(position + query.length))
                );
            }
        },

        events: {
            input: {
                selection: event => {
                    addTerm(event.detail.selection.value);

                    // Refresh suggestions after the library closes the list.
                    queueMicrotask(() => autocomplete.start());
                }
            }
        }
    });

    autocomplete.wrapper.classList.add("position-static", "flex-shrink-0");

    exact.addEventListener("change", () => autocomplete.start());
}

initTermSearch().catch(error => {
    console.error(error);
    $("#selected-terms").text("Failed to load term search.");
});


let matchRequest = 0;

async function updateMatches() {
    const requestId = ++matchRequest;
    const minimum = document.getElementById("min-matches");
    const ids = getSelectedHpoIds();
    const panels = $("#matching-genes, #gene-match-summary, #genes-match-stats");

    panels.empty();
    if (!ids.length || !minimum.checkValidity()) return;

    const mode = $(".select-search-in").val();

    panels.html(`
        <div class="d-flex justify-content-center align-items-center h-100">
            Loading...
        </div>
    `);

    try {
        const mode = $(".select-search-in").val();

        const response = await fetch(
            `/matches?min_matches=${minimum.valueAsNumber}&mode=${mode}`,
            {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify(ids)
            }
        );

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        const data = await response.json();

        // Ignore responses for an outdated selection.
        if (requestId !== matchRequest) return;

        // Ignore responses for an outdated selection.
        $("#matching-genes").empty().append(
            $("<div>", {
                class: "sticky-top text-center fw-bold p-2 border-bottom sticky-top",
                style: "background-color: #d1e7dd; color: #075a42;"
            }).append(
                $("<span>", {
                    text: `Genes: ${data.genes.length}`
                }),
                $("<button>", {
                    type: "button",
                    class: "btn btn-sm bg-transparent border border-success rounded-4 position-absolute top-50 end-0 translate-middle-y me-1",
                    style: "width: 65px;",
                    text: "Copy",
                    disabled: !data.genes.length
                }).on("click", async function () {
                    try {
                        await navigator.clipboard.writeText(data.genes.join(", "));
                        $(this).text("Copied");
                        setTimeout(() => $(this).text("Copy"), 1500);
                    } catch (error) {
                        alert("Could not copy genes.");
                    }
                })
            ),
            $("<div>", {
                class: "p-2",
                text: data.genes.join(", ")
            })
        );

        if (!data.result_count) {
            $("#gene-match-summary, #genes-match-stats").html(`
                <div class="d-flex justify-content-center align-items-center h-100">
                    No matches found.
                </div>
            `);

            return;
        }

        $("#gene-match-summary").html(data.summary_html);
        const summaryTable = $("#gene-match-summary table");

        const widths = mode === "gene"
            ? ["20%", "15%", "65%"]
            : ["29%", "29%", "13%", "29%"];

        const colgroup = $("<colgroup>");

        widths.forEach(width => {
            $("<col>").css("width", width).appendTo(colgroup);
        });

        summaryTable.prepend(colgroup);

        const searchInput = $("<input>", {
            type: "search",
            class: "form-control bg-white form-control-sm border border-success rounded-4 focus-ring focus-ring-success",
            placeholder: "Search summary",
            "aria-label": "Search summary"
        });

        summaryTable.find("thead").prepend(
            $("<tr>").append(
                $("<th>", {
                    colspan: summaryTable.find("thead tr").first().children().length,
                    class: "p-1"
                }).append(searchInput)
            )
        );

        searchInput.on("input", function () {
            const query = this.value.trim().toLowerCase();

            summaryTable.find("tbody tr").each(function () {
                const text = $(this).children("td").map(function () {
                    return $(this).text();
                }).get().join(" ").toLowerCase();

                $(this).toggle(text.includes(query));
            });
        });

        if (mode === "disease") {
            $("#gene-match-summary tbody tr").each(function () {
                const cell = $(this).children("td").eq(1);
                const text = cell.text();
                const match = text.match(/\((OMIM|ORPHA):(\d+)\)$/);

                if (!match) return;

                const [suffix, database, number] = match;
                const url = database === "OMIM"
                    ? `https://omim.org/entry/${number}`
                    : `https://www.orpha.net/en/disease/detail/${number}`;

                cell.empty().append(
                    document.createTextNode(text.slice(0, -suffix.length) + "("),
                    $("<a>", {
                        href: url,
                        text: `${database}:${number}`,
                        target: "_blank",
                        rel: "noopener noreferrer"
                    }),
                    document.createTextNode(")")
                );
            });
        }
        $("#gene-match-summary tbody tr").each(function () {
            const cells = $(this).children("td");
            const cell = cells.first();
            const text = cell.text().trim();

            if (!text || text === "—") return;

            const rowId = mode === "gene"
                ? text
                : cells.eq(1).text().trim().match(/\(([^()]+)\)$/)?.[1];

            const matchedIds = data.matched_hpo_ids[rowId] || [];
            const genes = text.split(",").map(gene => gene.trim());

            cell.empty();

            genes.forEach((gene, index) => {
                if (index > 0) {
                    cell.append(document.createTextNode(", "));
                }

                const params = new URLSearchParams({ gene });

                matchedIds.forEach(id => {
                    params.append("highlight", id);
                });

                cell.append(
                    $("<a>", {
                        href: `/gene?${params.toString()}`,
                        text: gene,
                        target: "_blank",
                        rel: "noopener noreferrer"
                    })
                );
            });
        });
        $("#genes-match-stats").html(data.stats_html);

    } catch (error) {
        if (requestId !== matchRequest) return;

        panels.text("Failed to load matches.");
        console.error(error);
    }
}

$("#min-matches").on("input", updateMatches);


$(".select-search-in").on("change", updateMatches);


$("#clear-terms").on("click", function () {
    selectedTerms.clear();
    $("#selected-terms").empty();

    const input = document.getElementById("search-input");
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));

    updateMatches();
});


$("#copy-terms").on("click", async function () {
    const text = [...selectedTerms.values()].join("; ");

    if (!text) return;

    try {
        await navigator.clipboard.writeText(text);

        $(this).text("Copied");
        setTimeout(() => $(this).text("Copy"), 1500);
    } catch (error) {
        console.error(error);
        alert("Could not copy terms.");
    }
});