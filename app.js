import { DAO } from './dao.js';

const meuDao = new DAO();

let dadosGlobaisEbola = [];
let dadosGeoGlobais = null;

let paisSelecionadoAtual = "";
let anoSelecionadoAtual = "";
let modoRankingPrincipal = "pais";
let playAtivo = false;
let intervaloPlay = null;

const tooltip = d3.select('body')
    .append('div')
    .attr('class', 'tooltip');

function normalizarPais(nome) {
    if (!nome) return "";

    const pais = String(nome).trim();

    if (
        pais === "DR Congo" ||
        pais === "Democratic Republic of the Congo" ||
        pais === "COD" ||
        pais === "Congo, Dem. Rep." ||
        pais === "Dem. Rep. Congo" ||
        pais === "Congo (Kinshasa)"
    ) return "Democratic Republic of the Congo";

    if (pais === "Guinea") return "Guinea";
    if (pais === "Guinea-Bissau") return "Guinea-Bissau";
    if (pais === "Equatorial Guinea") return "Equatorial Guinea";

    if (pais === "Sierra Leone") return "Sierra Leone";
    if (pais === "Liberia") return "Liberia";
    if (pais === "Uganda") return "Uganda";
    if (pais === "Nigeria") return "Nigeria";
    if (pais === "Mali") return "Mali";
    if (pais === "Senegal") return "Senegal";

    if (pais === "Spain") return "Spain";
    if (pais === "Italy") return "Italy";
    if (pais === "United Kingdom") return "United Kingdom";
    if (pais === "United States") return "United States";
    if (pais === "United States of America") return "United States";

    return pais;
}

function nomeCurtoPais(nome) {
    if (nome === "Democratic Republic of the Congo") return "DR Congo";
    if (nome === "United States") return "EUA";
    if (nome === "United Kingdom") return "Reino Unido";
    return nome;
}

function obterPaisesNoMapaAfrica() {
    if (!dadosGeoGlobais) return new Set();

    return new Set(
        dadosGeoGlobais.features.map(feature =>
            normalizarPais(feature.properties.name || feature.properties.ADMIN)
        )
    );
}

function obterDadosDoAno() {
    return dadosGlobaisEbola
        .filter(d => d.ano === Number(anoSelecionadoAtual) && d.casos > 0)
        .sort((a, b) => b.casos - a.casos);
}

function obterDadosAfricanosDoAno() {
    const paisesAfrica = obterPaisesNoMapaAfrica();

    return obterDadosDoAno()
        .filter(d => paisesAfrica.has(d.pais));
}

function obterDadosImportadosDoAno() {
    const paisesAfrica = obterPaisesNoMapaAfrica();

    return obterDadosDoAno()
        .filter(d => !paisesAfrica.has(d.pais));
}

function obterTotaisPorAno() {
    return d3.rollups(
        dadosGlobaisEbola,
        v => ({
            casos: d3.sum(v, d => d.casos),
            obitos: d3.sum(v, d => d.obitos)
        }),
        d => d.ano
    )
        .map(([ano, stats]) => ({
            ano,
            label: String(ano),
            casos: stats.casos,
            obitos: stats.obitos,
            casosPorObito: stats.obitos > 0 ? stats.casos / stats.obitos : 0,
            letalidade: stats.casos > 0 ? (stats.obitos / stats.casos) * 100 : 0
        }))
        .filter(d => d.casos > 0)
        .sort((a, b) => b.casos - a.casos);
}

function obterHistoricoPais(pais) {
    const totaisGlobaisPorAno = new Map(
        obterTotaisPorAno().map(d => [d.ano, d])
    );

    return d3.rollups(
        dadosGlobaisEbola.filter(d => d.pais === pais),
        v => ({
            casos: d3.sum(v, d => d.casos),
            obitos: d3.sum(v, d => d.obitos)
        }),
        d => d.ano
    )
        .map(([ano, stats]) => {
            const totalGlobalAno = totaisGlobaisPorAno.get(ano);
            const participacao = totalGlobalAno && totalGlobalAno.casos > 0
                ? (stats.casos / totalGlobalAno.casos) * 100
                : 0;

            return {
                ano,
                label: String(ano),
                casos: stats.casos,
                obitos: stats.obitos,
                letalidade: stats.casos > 0 ? (stats.obitos / stats.casos) * 100 : 0,
                casosPorObito: stats.obitos > 0 ? stats.casos / stats.obitos : 0,
                participacao
            };
        })
        .filter(d => d.casos > 0)
        .sort((a, b) => b.ano - a.ano);
}

function obterPaisAtivo(dadosAno) {
    if (!dadosAno.length) return null;

    if (!paisSelecionadoAtual || !dadosAno.some(d => d.pais === paisSelecionadoAtual)) {
        paisSelecionadoAtual = dadosAno[0].pais;
    }

    return dadosAno.find(d => d.pais === paisSelecionadoAtual);
}

function atualizarKPIs(dadosAno) {
    const totalCasos = d3.sum(dadosAno, d => d.casos);
    const totalObitos = d3.sum(dadosAno, d => d.obitos);
    const letalidade = totalCasos > 0 ? (totalObitos / totalCasos) * 100 : 0;

    const dadosAfrica = obterDadosAfricanosDoAno();
    const dadosImportados = obterDadosImportadosDoAno();

    const paisesAfricanosAfetados = new Set(dadosAfrica.map(d => d.pais)).size;
    const casosImportados = d3.sum(dadosImportados, d => d.casos);

    d3.select("#kpi-casos").text(totalCasos.toLocaleString());
    d3.select("#kpi-obitos").text(totalObitos.toLocaleString());
    d3.select("#kpi-letalidade").text(`${letalidade.toFixed(1)}%`);
    d3.select("#kpi-paises").text(paisesAfricanosAfetados.toLocaleString());
    d3.select("#kpi-importados").text(casosImportados.toLocaleString());
}

function atualizarResumoPaisAtivo(paisAtivo) {
    if (!paisAtivo) return;

    const letalidade = paisAtivo.casos > 0
        ? (paisAtivo.obitos / paisAtivo.casos) * 100
        : 0;

    d3.select("#pais-ativo-card").text(nomeCurtoPais(paisSelecionadoAtual));
    d3.select("#resumo-ano").text(anoSelecionadoAtual);
    d3.select("#resumo-casos").text(paisAtivo.casos.toLocaleString());
    d3.select("#resumo-obitos").text(paisAtivo.obitos.toLocaleString());
    d3.select("#resumo-letalidade").text(`${letalidade.toFixed(1)}%`);
}

function atualizarDashboard() {
    const dadosAno = obterDadosDoAno();

    if (dadosAno.length === 0) {
        limparGraficos();
        return;
    }

    const dadosAfrica = obterDadosAfricanosDoAno();
    const baseParaPaisAtivo = dadosAfrica.length > 0 ? dadosAfrica : dadosAno;
    const paisAtivo = obterPaisAtivo(baseParaPaisAtivo);

    atualizarKPIs(dadosAno);
    atualizarResumoPaisAtivo(paisAtivo);

    renderizarMapaAfrica(dadosGeoGlobais);
    renderizarRankingPrincipal();
    renderizarLetalidadeHistoricaDoPais();
    renderizarParticipacaoHistoricaDoPais();
    renderizarHeatmapAnoPais();
    renderizarLinhaTempoGlobal();
}

function limparGraficos() {
    d3.select("#mapa-africa").selectAll("*").remove();
    d3.select("#ranking-casos").selectAll("*").remove();
    d3.select("#ranking-letalidade").selectAll("*").remove();
    d3.select("#participacao-casos").selectAll("*").remove();
    d3.select("#heatmap-ano-pais").selectAll("*").remove();
    d3.select("#linha-tempo-global").selectAll("*").remove();
}

Promise.all([
    meuDao.carregarDadosEpidemiologicos(),
    d3.json('data/africa.geojson')
]).then(([dadosEbola, dadosGeo]) => {
    dadosGlobaisEbola = dadosEbola;
    dadosGeoGlobais = dadosGeo;

    const anos = d3.rollups(
        dadosGlobaisEbola,
        v => d3.sum(v, d => d.casos),
        d => d.ano
    )
        .filter(d => d[1] > 0)
        .sort((a, b) => b[0] - a[0]);

    if (anos.length === 0) {
        console.error("Nenhum ano com casos encontrado no dataset.");
        return;
    }

    anoSelecionadoAtual = String(anos[0][0]);

    const seletor = d3.select("#container-legenda-html")
        .html("")
        .append("select")
        .attr("id", "seletor-ano-painel");

    seletor.selectAll("option")
        .data(anos)
        .enter()
        .append("option")
        .attr("value", d => d[0])
        .text(d => `Ano ${d[0]} (${d[1].toLocaleString()} casos)`);

    seletor.property("value", anoSelecionadoAtual);

    seletor.on("change", function(event) {
        anoSelecionadoAtual = event.target.value;
        paisSelecionadoAtual = "";
        atualizarDashboard();
    });

    d3.selectAll('input[name="rankingMode"]').on("change", function() {
        modoRankingPrincipal = this.value;
        renderizarRankingPrincipal();
    });

    d3.select("#btn-play-anos").on("click", alternarPlayAnos);

    atualizarDashboard();

}).catch(error => console.error("Erro fatal na inicialização:", error));

function alternarPlayAnos() {
    const anosOrdenados = obterTotaisPorAno()
        .map(d => String(d.ano))
        .sort((a, b) => Number(a) - Number(b));

    if (!playAtivo) {
        playAtivo = true;
        d3.select("#btn-play-anos").text("Pause");

        intervaloPlay = setInterval(() => {
            const indiceAtual = anosOrdenados.indexOf(String(anoSelecionadoAtual));
            const proximoIndice = indiceAtual >= 0
                ? (indiceAtual + 1) % anosOrdenados.length
                : 0;

            anoSelecionadoAtual = anosOrdenados[proximoIndice];
            paisSelecionadoAtual = "";

            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);

            atualizarDashboard();
        }, 2200);

        return;
    }

    playAtivo = false;
    d3.select("#btn-play-anos").text("Play anos");
    clearInterval(intervaloPlay);
}

function renderizarMapaAfrica(geoData) {
    const svg = d3.select("#mapa-africa");
    svg.selectAll("*").remove();

    const dadosAno = obterDadosAfricanosDoAno();
    const casosPorPais = new Map(dadosAno.map(d => [d.pais, d.casos]));
    const maxCasos = d3.max(dadosAno, d => d.casos) || 1;

    const container = document.getElementById("mapa-africa");
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;

    const projection = d3.geoMercator().fitSize([width, height], geoData);
    const path = d3.geoPath().projection(projection);

    const corMagnitude = d3.scaleSequentialLog()
        .domain([1, maxCasos])
        .interpolator(d3.interpolateReds);

    const features = geoData.features.map(feature => {
        const pais = normalizarPais(feature.properties.name || feature.properties.ADMIN);

        return {
            ...feature,
            paisNormalizado: pais,
            casos: casosPorPais.get(pais) || 0
        };
    });

    svg.append("g")
        .selectAll("path")
        .data(features)
        .enter()
        .append("path")
        .attr("d", path)
        .attr("fill", d => {
            if (d.casos <= 0) return "#334155";
            if (d.paisNormalizado === paisSelecionadoAtual) return "#ef4444";
            return corMagnitude(d.casos);
        })
        .attr("stroke", d => d.paisNormalizado === paisSelecionadoAtual ? "#f8fafc" : "#0f172a")
        .attr("stroke-width", d => d.paisNormalizado === paisSelecionadoAtual ? 2.2 : 1)
        .style("cursor", d => d.casos > 0 ? "pointer" : "default")
        .on("mouseover", function(event, d) {
            if (d.casos <= 0) return;

            d3.select(this)
                .attr("fill", "#f87171")
                .attr("stroke", "#f8fafc")
                .attr("stroke-width", 2.2);

            tooltip
                .style("opacity", 1)
                .html(
                    `<strong>${d.paisNormalizado}</strong><br>` +
                    `Casos: ${d.casos.toLocaleString()}`
                );
        })
        .on("mousemove", function(event) {
            tooltip
                .style("left", `${event.pageX + 10}px`)
                .style("top", `${event.pageY - 20}px`);
        })
        .on("mouseleave", function(event, d) {
            d3.select(this)
                .attr("fill", () => {
                    if (d.casos <= 0) return "#334155";
                    if (d.paisNormalizado === paisSelecionadoAtual) return "#ef4444";
                    return corMagnitude(d.casos);
                })
                .attr("stroke", d.paisNormalizado === paisSelecionadoAtual ? "#f8fafc" : "#0f172a")
                .attr("stroke-width", d.paisNormalizado === paisSelecionadoAtual ? 2.2 : 1);

            tooltip.style("opacity", 0);
        })
        .on("click", function(event, d) {
            if (d.casos > 0) {
                paisSelecionadoAtual = d.paisNormalizado;
                modoRankingPrincipal = "historicoPais";

                d3.select('input[name="rankingMode"][value="historicoPais"]')
                    .property("checked", true);

                atualizarDashboard();
            }
        });
}

function renderizarRankingPrincipal() {
    if (modoRankingPrincipal === "pais") {
        d3.select("#titulo-ranking-principal").text("2. Ranking de Casos por País no Ano");

        const dadosAno = obterDadosDoAno();

        renderizarBarrasHorizontais({
            seletor: "#ranking-casos",
            dados: dadosAno.map(d => ({
                label: d.pais,
                valor: d.casos,
                casos: d.casos,
                obitos: d.obitos
            })),
            tituloTooltip: "Casos",
            formato: d => d.toLocaleString(),
            destacarLabel: paisSelecionadoAtual,
            aoClicar: d => {
                paisSelecionadoAtual = d.label;
                modoRankingPrincipal = "historicoPais";

                d3.select('input[name="rankingMode"][value="historicoPais"]')
                    .property("checked", true);

                atualizarDashboard();
            }
        });

        return;
    }

    if (modoRankingPrincipal === "ano") {
        d3.select("#titulo-ranking-principal").text("2. Ranking Global de Casos por Ano");

        const dadosAnos = obterTotaisPorAno()
            .sort((a, b) => b.casos - a.casos);

        renderizarBarrasHorizontais({
            seletor: "#ranking-casos",
            dados: dadosAnos.map(d => ({
                label: String(d.ano),
                valor: d.casos,
                casos: d.casos,
                obitos: d.obitos
            })),
            tituloTooltip: "Casos no ano",
            formato: d => d.toLocaleString(),
            destacarLabel: String(anoSelecionadoAtual),
            aoClicar: d => {
                anoSelecionadoAtual = String(d.label);
                paisSelecionadoAtual = "";
                d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
                atualizarDashboard();
            }
        });

        return;
    }

    if (modoRankingPrincipal === "casosPorObito") {
        d3.select("#titulo-ranking-principal").text("2. Casos por Óbito por Ano");

        const dadosCasosPorObito = obterTotaisPorAno()
            .filter(d => d.obitos > 0)
            .sort((a, b) => b.casosPorObito - a.casosPorObito);

        renderizarBarrasHorizontais({
            seletor: "#ranking-casos",
            dados: dadosCasosPorObito.map(d => ({
                label: String(d.ano),
                valor: d.casosPorObito,
                casos: d.casos,
                obitos: d.obitos
            })),
            tituloTooltip: "Casos por óbito",
            formato: d => `${d.toFixed(2)} casos/óbito`,
            destacarLabel: String(anoSelecionadoAtual),
            aoClicar: d => {
                anoSelecionadoAtual = String(d.label);
                paisSelecionadoAtual = "";
                d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
                atualizarDashboard();
            }
        });

        return;
    }

    if (modoRankingPrincipal === "importados") {
        d3.select("#titulo-ranking-principal").text(`2. Casos Importados — ${anoSelecionadoAtual}`);

        const dadosImportados = obterDadosImportadosDoAno();

        renderizarBarrasHorizontais({
            seletor: "#ranking-casos",
            dados: dadosImportados.map(d => ({
                label: d.pais,
                valor: d.casos,
                casos: d.casos,
                obitos: d.obitos
            })),
            tituloTooltip: "Casos importados",
            formato: d => d.toLocaleString(),
            destacarLabel: paisSelecionadoAtual,
            aoClicar: d => {
                paisSelecionadoAtual = d.label;
                atualizarDashboard();
            },
            mensagemVazia: "Sem casos importados neste ano."
        });

        return;
    }

    d3.select("#titulo-ranking-principal").text(`2. Histórico de Casos — ${nomeCurtoPais(paisSelecionadoAtual)}`);

    const historico = obterHistoricoPais(paisSelecionadoAtual)
        .sort((a, b) => b.casos - a.casos);

    renderizarBarrasHorizontais({
        seletor: "#ranking-casos",
        dados: historico.map(d => ({
            label: String(d.ano),
            valor: d.casos,
            casos: d.casos,
            obitos: d.obitos
        })),
        tituloTooltip: "Casos do país no ano",
        formato: d => d.toLocaleString(),
        destacarLabel: String(anoSelecionadoAtual),
        aoClicar: d => {
            anoSelecionadoAtual = String(d.label);
            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
            atualizarDashboard();
        }
    });
}

function renderizarLetalidadeHistoricaDoPais() {
    d3.select("#titulo-painel-letalidade").text(`3. Letalidade Anual — ${nomeCurtoPais(paisSelecionadoAtual)}`);

    const historico = obterHistoricoPais(paisSelecionadoAtual)
        .sort((a, b) => b.letalidade - a.letalidade);

    renderizarBarrasHorizontais({
        seletor: "#ranking-letalidade",
        dados: historico.map(d => ({
            label: String(d.ano),
            valor: d.letalidade,
            casos: d.casos,
            obitos: d.obitos
        })),
        tituloTooltip: "Letalidade",
        formato: d => `${d.toFixed(1)}%`,
        destacarLabel: String(anoSelecionadoAtual),
        dominioMaximo: 100,
        aoClicar: d => {
            anoSelecionadoAtual = String(d.label);
            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
            atualizarDashboard();
        }
    });
}

function renderizarParticipacaoHistoricaDoPais() {
    d3.select("#titulo-painel-participacao").text(`4. Participação Global — ${nomeCurtoPais(paisSelecionadoAtual)}`);

    const historico = obterHistoricoPais(paisSelecionadoAtual)
        .sort((a, b) => b.participacao - a.participacao);

    renderizarBarrasHorizontais({
        seletor: "#participacao-casos",
        dados: historico.map(d => ({
            label: String(d.ano),
            valor: d.participacao,
            casos: d.casos,
            obitos: d.obitos
        })),
        tituloTooltip: "Participação no total global",
        formato: d => `${d.toFixed(1)}%`,
        destacarLabel: String(anoSelecionadoAtual),
        dominioMaximo: 100,
        aoClicar: d => {
            anoSelecionadoAtual = String(d.label);
            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
            atualizarDashboard();
        }
    });
}

function renderizarHeatmapAnoPais() {
    const svg = d3.select("#heatmap-ano-pais");
    svg.selectAll("*").remove();

    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;
    const margin = { top: 30, right: 30, bottom: 50, left: 180 };

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const anos = [...new Set(dadosGlobaisEbola.map(d => d.ano))]
        .sort((a, b) => a - b);

    const paises = [...new Set(dadosGlobaisEbola.filter(d => d.casos > 0).map(d => d.pais))]
        .sort();

    const matriz = [];

    paises.forEach(pais => {
        anos.forEach(ano => {
            const registros = dadosGlobaisEbola.filter(d => d.pais === pais && d.ano === ano);
            matriz.push({
                pais,
                ano,
                casos: d3.sum(registros, d => d.casos),
                obitos: d3.sum(registros, d => d.obitos)
            });
        });
    });

    const maxCasos = d3.max(matriz, d => d.casos) || 1;

    const x = d3.scaleBand()
        .domain(anos.map(String))
        .range([0, innerWidth])
        .padding(0.05);

    const y = d3.scaleBand()
        .domain(paises)
        .range([0, innerHeight])
        .padding(0.05);

    const cor = d3.scaleSequentialLog()
        .domain([1, maxCasos])
        .interpolator(d3.interpolateReds);

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    g.selectAll("rect")
        .data(matriz)
        .enter()
        .append("rect")
        .attr("x", d => x(String(d.ano)))
        .attr("y", d => y(d.pais))
        .attr("width", x.bandwidth())
        .attr("height", y.bandwidth())
        .attr("fill", d => d.casos > 0 ? cor(d.casos) : "#334155")
        .attr("stroke", d => {
            if (String(d.ano) === String(anoSelecionadoAtual) && d.pais === paisSelecionadoAtual) return "#f8fafc";
            return "#1e293b";
        })
        .attr("stroke-width", d => {
            if (String(d.ano) === String(anoSelecionadoAtual) && d.pais === paisSelecionadoAtual) return 2;
            return 0.5;
        })
        .style("cursor", d => d.casos > 0 ? "pointer" : "default")
        .on("mouseover", function(event, d) {
            tooltip
                .style("opacity", 1)
                .html(
                    `<strong>${d.pais}</strong><br>` +
                    `Ano: ${d.ano}<br>` +
                    `Casos: ${d.casos.toLocaleString()}<br>` +
                    `Óbitos: ${d.obitos.toLocaleString()}`
                );
        })
        .on("mousemove", function(event) {
            tooltip
                .style("left", `${event.pageX + 10}px`)
                .style("top", `${event.pageY - 20}px`);
        })
        .on("mouseleave", function() {
            tooltip.style("opacity", 0);
        })
        .on("click", function(event, d) {
            if (d.casos > 0) {
                anoSelecionadoAtual = String(d.ano);
                paisSelecionadoAtual = d.pais;

                d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
                modoRankingPrincipal = "historicoPais";
                d3.select('input[name="rankingMode"][value="historicoPais"]').property("checked", true);

                atualizarDashboard();
            }
        });

    g.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x))
        .attr("color", "#94a3b8");

    g.append("g")
        .call(d3.axisLeft(y))
        .attr("color", "#94a3b8")
        .selectAll("text")
        .style("font-size", "10px");
}

function renderizarLinhaTempoGlobal() {
    const svg = d3.select("#linha-tempo-global");
    svg.selectAll("*").remove();

    const dados = obterTotaisPorAno()
        .sort((a, b) => a.ano - b.ano);

    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;
    const margin = { top: 25, right: 40, bottom: 45, left: 80 };

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const x = d3.scaleBand()
        .domain(dados.map(d => String(d.ano)))
        .range([0, innerWidth])
        .padding(0.25);

    const y = d3.scaleLinear()
        .domain([0, d3.max(dados, d => d.casos) || 1])
        .nice()
        .range([innerHeight, 0]);

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    g.selectAll("rect")
        .data(dados)
        .enter()
        .append("rect")
        .attr("x", d => x(String(d.ano)))
        .attr("y", d => y(d.casos))
        .attr("width", x.bandwidth())
        .attr("height", d => innerHeight - y(d.casos))
        .attr("rx", 4)
        .attr("fill", d => String(d.ano) === String(anoSelecionadoAtual) ? "#ef4444" : "#38bdf8")
        .style("cursor", "pointer")
        .on("mouseover", function(event, d) {
            tooltip
                .style("opacity", 1)
                .html(
                    `<strong>${d.ano}</strong><br>` +
                    `Casos: ${d.casos.toLocaleString()}<br>` +
                    `Óbitos: ${d.obitos.toLocaleString()}`
                );
        })
        .on("mousemove", function(event) {
            tooltip
                .style("left", `${event.pageX + 10}px`)
                .style("top", `${event.pageY - 20}px`);
        })
        .on("mouseleave", function() {
            tooltip.style("opacity", 0);
        })
        .on("click", function(event, d) {
            anoSelecionadoAtual = String(d.ano);
            paisSelecionadoAtual = "";

            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);

            atualizarDashboard();
        });

    g.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x))
        .attr("color", "#94a3b8");

    g.append("g")
        .call(d3.axisLeft(y).ticks(5))
        .attr("color", "#94a3b8");
}

function renderizarBarrasHorizontais({
    seletor,
    dados,
    tituloTooltip,
    formato,
    destacarLabel = null,
    dominioMaximo = null,
    aoClicar = null,
    mensagemVazia = "Sem dados disponíveis."
}) {
    const svg = d3.select(seletor);
    svg.selectAll("*").remove();

    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;

    const dadosLimitados = dados.slice(0, 10);

    if (dadosLimitados.length === 0) {
        svg.append("text")
            .attr("x", width / 2)
            .attr("y", height / 2)
            .attr("text-anchor", "middle")
            .attr("fill", "#94a3b8")
            .style("font-size", "13px")
            .style("font-weight", "bold")
            .text(mensagemVazia);

        return;
    }

    const margin = { top: 20, right: 105, bottom: 30, left: 175 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);

    const xMax = dominioMaximo ?? (d3.max(dadosLimitados, d => d.valor) || 1);

    const x = d3.scaleLinear()
        .domain([0, xMax * 1.08])
        .range([0, innerWidth]);

    const y = d3.scaleBand()
        .domain(dadosLimitados.map(d => d.label))
        .range([0, innerHeight])
        .padding(0.25);

    g.selectAll("rect")
        .data(dadosLimitados)
        .enter()
        .append("rect")
        .attr("x", 0)
        .attr("y", d => y(d.label))
        .attr("width", d => x(d.valor))
        .attr("height", y.bandwidth())
        .attr("rx", 4)
        .attr("fill", d => String(d.label) === String(destacarLabel) ? "#ef4444" : "#38bdf8")
        .style("cursor", aoClicar ? "pointer" : "default")
        .on("mouseover", function(event, d) {
            d3.select(this).attr("opacity", 0.85);

            tooltip
                .style("opacity", 1)
                .html(
                    `<strong>${d.label}</strong><br>` +
                    `${tituloTooltip}: <strong>${formato(d.valor)}</strong><br>` +
                    `Casos: ${d.casos.toLocaleString()}<br>` +
                    `Óbitos: ${d.obitos.toLocaleString()}`
                );
        })
        .on("mousemove", function(event) {
            tooltip
                .style("left", `${event.pageX + 10}px`)
                .style("top", `${event.pageY - 20}px`);
        })
        .on("mouseleave", function() {
            d3.select(this).attr("opacity", 1);
            tooltip.style("opacity", 0);
        })
        .on("click", function(event, d) {
            if (aoClicar) aoClicar(d);
        });

    g.selectAll(".valor-barra")
        .data(dadosLimitados)
        .enter()
        .append("text")
        .attr("class", "valor-barra")
        .attr("x", d => Math.min(x(d.valor) + 6, innerWidth + 4))
        .attr("y", d => y(d.label) + y.bandwidth() / 2 + 4)
        .attr("fill", "#f8fafc")
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .text(d => formato(d.valor));

    g.append("g")
        .call(d3.axisLeft(y))
        .attr("color", "#94a3b8")
        .selectAll("text")
        .style("font-size", "10px");

    g.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).ticks(5))
        .attr("color", "#94a3b8");
}