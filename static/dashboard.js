const totalCount = document.getElementById("totalCount");
const groupedResponses = document.getElementById("groupedResponses");
const statusText = document.getElementById("statusText");
const promptModal = document.getElementById("promptModal");
const promptContent = document.getElementById("promptContent");
const wordCloudT1 = document.getElementById("wordCloudT1");
const wordCloudT2 = document.getElementById("wordCloudT2");

let treatmentChart;
let reasonChart;

Chart.defaults.font.family = "Cambria, Times New Roman, Times, serif";
Chart.defaults.color = "#0a113f";

function toPercent(part, whole) {
  if (!whole) return 0;
  return Number(((part / whole) * 100).toFixed(1));
}

function renderGroupedResponses(rows) {
  const order = ["T1|accept", "T1|reject", "T2|accept", "T2|reject"];
  const grouped = {
    "T1|accept": [],
    "T1|reject": [],
    "T2|accept": [],
    "T2|reject": [],
  };
  rows.forEach((row) => {
    const key = `${row.treatment}|${row.q1_choice}`;
    if (grouped[key]) grouped[key].push(row);
  });

  groupedResponses.innerHTML = "";
  order.forEach((key) => {
    const [treatment, choice] = key.split("|");
    const list = grouped[key];
    const section = document.createElement("details");
    section.className = "response-group";

    const summary = document.createElement("summary");
    const choiceLabel = choice === "accept" ? "Accept" : "Reject";
    summary.textContent = `${treatment} - ${choiceLabel} (${list.length})`;
    section.appendChild(summary);

    const table = document.createElement("table");
    table.innerHTML = `
      <thead>
        <tr>
          <th>Text Reason</th>
          <th>Label</th>
        </tr>
      </thead>
      <tbody></tbody>
    `;

    const tbody = table.querySelector("tbody");
    if (!list.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="2" class="tiny">No responses in this group yet.</td>`;
      tbody.appendChild(tr);
    } else {
      list.forEach((row) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${row.q2_text}</td>
          <td>${row.reason_label || "unclassified"}</td>
        `;
        tbody.appendChild(tr);
      });
    }
    section.appendChild(table);
    groupedResponses.appendChild(section);
  });
}

function refreshWordClouds() {
  const t = Date.now();
  wordCloudT1.src = `/api/wordcloud_image/T1?t=${t}`;
  wordCloudT2.src = `/api/wordcloud_image/T2?t=${t}`;
}

function initCharts() {
  const tctx = document.getElementById("treatmentChart");
  const rctx = document.getElementById("reasonChart");

  treatmentChart = new Chart(tctx, {
    type: "bar",
    data: {
      labels: ["Accept", "Reject"],
      datasets: [
        {
          label: "T1",
          data: [0, 0],
          backgroundColor: "#007f78"
        },
        {
          label: "T2",
          data: [0, 0],
          backgroundColor: "#00a651"
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        x: {
          ticks: { minRotation: 0, maxRotation: 0 }
        },
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            stepSize: 10,
            callback: (value) => `${value}%`
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`
          }
        }
      }
    }
  });

  reasonChart = new Chart(rctx, {
    type: "bar",
    data: {
      labels: ["Loss Focus", "Expected Value Focus", "Mixed/Other", "Unclassified"],
      datasets: [
        {
          label: "T1",
          data: [0, 0, 0, 0],
          backgroundColor: "#007f78"
        },
        {
          label: "T2",
          data: [0, 0, 0, 0],
          backgroundColor: "#00a651"
        }
      ]
    },
    options: {
      responsive: true,
      scales: {
        x: {
          ticks: { minRotation: 0, maxRotation: 0 }
        },
        y: {
          beginAtZero: true,
          max: 100,
          ticks: {
            stepSize: 10,
            callback: (value) => `${value}%`
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}%`
          }
        }
      }
    }
  });
}

async function refreshData() {
  const res = await fetch("/api/stats");
  const data = await res.json();

  totalCount.textContent = data.total;

  const t1Total = data.treatments.T1.accept + data.treatments.T1.reject;
  const t2Total = data.treatments.T2.accept + data.treatments.T2.reject;

  treatmentChart.data.datasets[0].data = [
    toPercent(data.treatments.T1.accept, t1Total),
    toPercent(data.treatments.T1.reject, t1Total)
  ];
  treatmentChart.data.datasets[1].data = [
    toPercent(data.treatments.T2.accept, t2Total),
    toPercent(data.treatments.T2.reject, t2Total)
  ];
  treatmentChart.update();

  const t1ReasonTotal =
    data.reason_labels_by_treatment.T1.loss_focus +
    data.reason_labels_by_treatment.T1.expected_value_focus +
    data.reason_labels_by_treatment.T1.mixed_or_other +
    data.reason_labels_by_treatment.T1.unclassified;
  const t2ReasonTotal =
    data.reason_labels_by_treatment.T2.loss_focus +
    data.reason_labels_by_treatment.T2.expected_value_focus +
    data.reason_labels_by_treatment.T2.mixed_or_other +
    data.reason_labels_by_treatment.T2.unclassified;

  reasonChart.data.datasets[0].data = [
    toPercent(data.reason_labels_by_treatment.T1.loss_focus, t1ReasonTotal),
    toPercent(data.reason_labels_by_treatment.T1.expected_value_focus, t1ReasonTotal),
    toPercent(data.reason_labels_by_treatment.T1.mixed_or_other, t1ReasonTotal),
    toPercent(data.reason_labels_by_treatment.T1.unclassified, t1ReasonTotal)
  ];
  reasonChart.data.datasets[1].data = [
    toPercent(data.reason_labels_by_treatment.T2.loss_focus, t2ReasonTotal),
    toPercent(data.reason_labels_by_treatment.T2.expected_value_focus, t2ReasonTotal),
    toPercent(data.reason_labels_by_treatment.T2.mixed_or_other, t2ReasonTotal),
    toPercent(data.reason_labels_by_treatment.T2.unclassified, t2ReasonTotal)
  ];
  reasonChart.update();

  renderGroupedResponses(data.latest_responses);
  refreshWordClouds();
}

async function analyzeNewTexts() {
  statusText.textContent = "Analyzing...";
  const res = await fetch("/api/analyze_texts", { method: "POST" });
  const data = await res.json();
  statusText.textContent = `Done. Analyzed ${data.analyzed_count} new responses.`;
  refreshData();
}

async function resetData() {
  const ok = window.confirm("Delete all survey responses?");
  if (!ok) return;
  await fetch("/api/reset", { method: "POST" });
  statusText.textContent = "All data reset.";
  refreshData();
}

async function showPrompt() {
  const res = await fetch("/api/prompt_template");
  const data = await res.json();
  promptContent.textContent = data.prompt_template;
  promptModal.classList.remove("hidden");
}

function closePrompt() {
  promptModal.classList.add("hidden");
}

document.getElementById("analyzeBtn").addEventListener("click", analyzeNewTexts);
document.getElementById("refreshBtn").addEventListener("click", refreshData);
document.getElementById("resetBtn").addEventListener("click", resetData);
document.getElementById("promptBtn").addEventListener("click", showPrompt);
document.getElementById("closePromptBtn").addEventListener("click", closePrompt);
promptModal.addEventListener("click", (e) => {
  if (e.target === promptModal) closePrompt();
});

initCharts();
refreshData();
