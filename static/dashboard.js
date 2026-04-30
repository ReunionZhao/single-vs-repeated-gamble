const totalCount = document.getElementById("totalCount");
const groupedResponses = document.getElementById("groupedResponses");
const statusText = document.getElementById("statusText");
const promptModal = document.getElementById("promptModal");
const promptContent = document.getElementById("promptContent");
const questionsModal = document.getElementById("questionsModal");
const wordCloudT1 = document.getElementById("wordCloudT1");
const wordCloudT2 = document.getElementById("wordCloudT2");

let treatmentChart;
let reasonChart;
let reasonDecisionChart;
const bubbleLabelPlugin = {
  id: "bubbleLabelPlugin",
  afterDatasetsDraw(chart) {
    if (chart.canvas.id !== "reasonDecisionChart") return;
    const { ctx } = chart;
    ctx.save();
    ctx.font = "12px Cambria, Times New Roman, Times, serif";
    ctx.fillStyle = "#0a113f";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    chart.data.datasets.forEach((dataset, di) => {
      const meta = chart.getDatasetMeta(di);
      meta.data.forEach((point, idx) => {
        const raw = dataset.data[idx];
        if (!raw) return;
        const txt = `${(raw.share * 100).toFixed(1)}%`;
        ctx.fillText(txt, point.x, point.y - raw.r - 8);
      });
    });
    ctx.restore();
  },
  afterDraw(chart) {
    if (chart.canvas.id !== "reasonDecisionChart") return;
    const { ctx, scales } = chart;
    const xScale = scales.x;
    const yScale = scales.y;
    const labels = [
      { x: 0, y: 1, text: "Loss + Accept" },
      { x: 0, y: 0, text: "Loss + Not Accept" },
      { x: 1, y: 1, text: "EV + Accept" },
      { x: 1, y: 0, text: "EV + Not Accept" },
    ];
    ctx.save();
    ctx.font = "bold 14px Cambria, Times New Roman, Times, serif";
    ctx.fillStyle = "#30517a";
    ctx.textAlign = "left";
    ctx.textBaseline = "top";
    labels.forEach((item) => {
      const px = xScale.getPixelForValue(item.x);
      const py = yScale.getPixelForValue(item.y);
      ctx.fillText(item.text, px - 62, py - 44);
    });
    ctx.restore();
  },
};
Chart.register(bubbleLabelPlugin);
const squarePlotAreaPlugin = {
  id: "squarePlotAreaPlugin",
  afterLayout(chart) {
    if (chart.canvas.id !== "reasonDecisionChart") return;
    const area = chart.chartArea;
    if (!area) return;
    const w = area.right - area.left;
    const h = area.bottom - area.top;
    const size = Math.min(w, h);
    const cx = (area.left + area.right) / 2;
    const cy = (area.top + area.bottom) / 2;
    chart.chartArea.left = cx - size / 2;
    chart.chartArea.right = cx + size / 2;
    chart.chartArea.top = cy - size / 2;
    chart.chartArea.bottom = cy + size / 2;
  },
};
Chart.register(squarePlotAreaPlugin);

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
  const rdctx = document.getElementById("reasonDecisionChart");

  treatmentChart = new Chart(tctx, {
    type: "bar",
    data: {
      labels: ["Accept", "Reject"],
      datasets: [
        {
          label: "T1 Single Trails",
          data: [0, 0],
          backgroundColor: "#007f78"
        },
        {
          label: "T2 Repeated Trails",
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
      labels: ["Loss Focus", "Expected Value Focus", "Mixed or Unclear"],
      datasets: [
        {
          label: "T1 Single Trails",
          data: [0, 0, 0],
          backgroundColor: "#007f78"
        },
        {
          label: "T2 Repeated Trails",
          data: [0, 0, 0],
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

  reasonDecisionChart = new Chart(rdctx, {
    type: "bubble",
    data: {
      datasets: [
        { label: "T1 Single Trails", data: [], backgroundColor: "rgba(0,127,120,0.6)", borderColor: "#007f78" },
        { label: "T2 Repeated Trails", data: [], backgroundColor: "rgba(0,166,166,0.6)", borderColor: "#00a6a6" },
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: true,
      aspectRatio: 1,
      scales: {
        x: {
          min: -0.5,
          max: 1.5,
          ticks: {
            stepSize: 1,
            callback: (v) => (v === 0 ? "Loss Focus" : v === 1 ? "Expected Value Focus" : "")
          }
        },
        y: {
          min: -0.5,
          max: 1.5,
          ticks: {
            stepSize: 1,
            callback: (v) => (v === 0 ? "Not Accept" : v === 1 ? "Accept" : "")
          }
        }
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const sharePct = (ctx.raw.share * 100).toFixed(1);
              return `${ctx.dataset.label}: ${sharePct}%`;
            }
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
    data.reason_labels_by_treatment.T1.mixed_or_other;
  const t2ReasonTotal =
    data.reason_labels_by_treatment.T2.loss_focus +
    data.reason_labels_by_treatment.T2.expected_value_focus +
    data.reason_labels_by_treatment.T2.mixed_or_other;

  reasonChart.data.datasets[0].data = [
    toPercent(data.reason_labels_by_treatment.T1.loss_focus, t1ReasonTotal),
    toPercent(data.reason_labels_by_treatment.T1.expected_value_focus, t1ReasonTotal),
    toPercent(data.reason_labels_by_treatment.T1.mixed_or_other, t1ReasonTotal)
  ];
  reasonChart.data.datasets[1].data = [
    toPercent(data.reason_labels_by_treatment.T2.loss_focus, t2ReasonTotal),
    toPercent(data.reason_labels_by_treatment.T2.expected_value_focus, t2ReasonTotal),
    toPercent(data.reason_labels_by_treatment.T2.mixed_or_other, t2ReasonTotal)
  ];
  reasonChart.update();

  const t1 = data.reason_decision_share.T1;
  const t2 = data.reason_decision_share.T2;
  const mkR = (share) => 10 + share * 48;
  const offset = 0.12;
  reasonDecisionChart.data.datasets[0].data = [
    { x: 0 - offset, y: 1 + offset, r: mkR(t1.loss_focus.accept), share: t1.loss_focus.accept },
    { x: 0 - offset, y: 0 + offset, r: mkR(t1.loss_focus.reject), share: t1.loss_focus.reject },
    { x: 1 - offset, y: 1 + offset, r: mkR(t1.expected_value_focus.accept), share: t1.expected_value_focus.accept },
    { x: 1 - offset, y: 0 + offset, r: mkR(t1.expected_value_focus.reject), share: t1.expected_value_focus.reject },
  ];
  reasonDecisionChart.data.datasets[1].data = [
    { x: 0 + offset, y: 1 - offset, r: mkR(t2.loss_focus.accept), share: t2.loss_focus.accept },
    { x: 0 + offset, y: 0 - offset, r: mkR(t2.loss_focus.reject), share: t2.loss_focus.reject },
    { x: 1 + offset, y: 1 - offset, r: mkR(t2.expected_value_focus.accept), share: t2.expected_value_focus.accept },
    { x: 1 + offset, y: 0 - offset, r: mkR(t2.expected_value_focus.reject), share: t2.expected_value_focus.reject },
  ];
  reasonDecisionChart.update();

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

function showQuestions() {
  questionsModal.classList.remove("hidden");
}

function closeQuestions() {
  questionsModal.classList.add("hidden");
}

document.getElementById("analyzeBtn").addEventListener("click", analyzeNewTexts);
document.getElementById("refreshBtn").addEventListener("click", refreshData);
document.getElementById("resetBtn").addEventListener("click", resetData);
document.getElementById("questionsBtn").addEventListener("click", showQuestions);
document.getElementById("promptBtn").addEventListener("click", showPrompt);
document.getElementById("closePromptBtn").addEventListener("click", closePrompt);
document.getElementById("closeQuestionsBtn").addEventListener("click", closeQuestions);
promptModal.addEventListener("click", (e) => {
  if (e.target === promptModal) closePrompt();
});
questionsModal.addEventListener("click", (e) => {
  if (e.target === questionsModal) closeQuestions();
});

initCharts();
refreshData();
