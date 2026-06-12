import { DAO } from './dao.js';

const meuDao = new DAO();

let dadosGlobaisEbola = [];
let dadosGeoGlobais = null;

let paisSelecionadoAtual = ""; 
let anoSelecionadoAtual = "";
let modoRankingPrincipal = "pais"; 
let modoAnalitico = "letalidade";
let playAtivo = false;
let intervaloPlay = null;

const tooltip = d3.select('body')
    .append('div')
    .attr('class', 'tooltip');

// LÓGICA INTERNA: Mantém strings estáveis em inglês para cruzamento seguro (joins) de dados
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

    if (pais === "Guinea" || pais === "Guiné") return "Guinea";
    if (pais === "Guinea-Bissau") return "Guinea-Bissau";
    if (pais === "Equatorial Guinea") return "Equatorial Guinea";
    if (pais === "Sierra Leone" || pais === "Serra Leoa") return "Sierra Leone";
    if (pais === "Liberia" || pais === "Libéria") return "Liberia";
    if (pais === "Uganda") return "Uganda";
    if (pais === "Nigeria" || pais === "Nigéria") return "Nigeria";
    if (pais === "Mali") return "Mali";
    if (pais === "Senegal") return "Senegal";
    if (pais === "Spain" || pais === "Espanha") return "Spain";
    if (pais === "Italy" || pais === "Itália") return "Italy";
    if (pais === "United Kingdom" || pais === "Reino Unido") return "United Kingdom";
    if (pais === "United States" || pais === "EUA" || pais === "United States of America" || pais === "Estados Unidos") return "United States";

    return pais;
}

// INTERFACE VISUAL: Traduz e acentua os nomes perfeitamente para exibição em português na tela
function nomeCurtoPais(nome) {
    const nomeNorm = normalizarPais(nome);
    if (nomeNorm === "Democratic Republic of the Congo") return "Congo";
    if (nomeNorm === "United States") return "EUA";
    if (nomeNorm === "United Kingdom") return "Reino Unido";
    if (nomeNorm === "Sierra Leone") return "Serra Leoa";
    if (nomeNorm === "Liberia") return "Libéria";
    if (nomeNorm === "Guinea") return "Guiné";
    if (nomeNorm === "Nigeria") return "Nigéria";
    if (nomeNorm === "Spain") return "Espanha";
    if (nomeNorm === "Italy") return "Itália";
    return nomeNorm;
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
        .map(d => ({ ...d, pais: normalizarPais(d.pais) }))
        .filter(d => d.ano === Number(anoSelecionadoAtual) && d.casos > 0)
        .sort((a, b) => b.casos - a.casos);
}

function obterDadosAfricanosDoAno() {
    const paisesAfrica = obterPaisesNoMapaAfrica();
    return obterDadosDoAno().filter(d => paisesAfrica.has(d.pais));
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
        ano: Number(ano),
        label: String(ano),
        casos: stats.casos,
        obitos: stats.obitos,
        casosPorObito: stats.obitos > 0 ? stats.casos / stats.obitos : 0,
        letalidade: stats.casos > 0 ? (stats.obitos / stats.casos) * 100 : 0
    }))
    .filter(d => d.casos > 0);
}

function obterHistoricoPais(pais) {
    const nomeNorm = normalizarPais(pais);
    const totaisGlobaisPorAno = new Map(
        obterTotaisPorAno().map(d => [d.ano, d])
    );

    return d3.rollups(
        dadosGlobaisEbola.filter(d => normalizarPais(d.pais) === nomeNorm),
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
                ano: Number(ano),
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
    if (!paisSelecionadoAtual) return null;
    const nomeNorm = normalizarPais(paisSelecionadoAtual);
    return dadosAno.find(d => normalizarPais(d.pais) === nomeNorm);
}

function atualizarKPIs(dadosAno) {
    const totalCasos = d3.sum(dadosAno, d => d.casos);
    const totalObitos = d3.sum(dadosAno, d => d.obitos);
    const letalidade = totalCasos > 0 ? (totalObitos / totalCasos) * 100 : 0;

    const paisesAfricanosBase = new Set([
        "Democratic Republic of the Congo", 
        "Guinea", 
        "Guinea-Bissau", 
        "Equatorial Guinea", 
        "Sierra Leone", 
        "Liberia", 
        "Uganda", 
        "Nigeria", 
        "Mali", 
        "Senegal"
    ]);

    const paisesAfricanosAfetados = dadosAno.filter(d => paisesAfricanosBase.has(d.pais)).length;
    const casesImported = d3.sum(dadosAno.filter(d => !paisesAfricanosBase.has(d.pais)), d => d.casos);

    d3.select("#kpi-casos").text(totalCasos.toLocaleString());
    d3.select("#kpi-obitos").text(totalObitos.toLocaleString());
    d3.select("#kpi-letalidade").text(`${letalidade.toFixed(1)}%`);
    d3.select("#kpi-paises").text(paisesAfricanosAfetados.toLocaleString());
    d3.select("#kpi-importados").text(casesImported.toLocaleString());
}

function atualizarResumoPaisAtivo() {
    if (!paisSelecionadoAtual) {
        d3.select("#pais-ativo-card").text("Todos (Global)");
        d3.select("#resumo-ano").text(anoSelecionadoAtual);
        const dadosAno = obterDadosDoAno();
        const totalCasos = d3.sum(dadosAno, d => d.casos);
        const totalObitos = d3.sum(dadosAno, d => d.obitos);
        const letalidade = totalCasos > 0 ? (totalObitos / totalCasos) * 100 : 0;

        d3.select("#resumo-casos").text(totalCasos.toLocaleString());
        d3.select("#resumo-obitos").text(totalObitos.toLocaleString());
        d3.select("#resumo-letalidade").text(`${letalidade.toFixed(1)}%`);
        return;
    }

    const nomeNorm = normalizarPais(paisSelecionadoAtual);
    const dadosPaisAno = dadosGlobaisEbola.find(d => normalizarPais(d.pais) === nomeNorm && d.ano === Number(anoSelecionadoAtual));
    const casos = dadosPaisAno ? dadosPaisAno.casos : 0;
    const obitos = dadosPaisAno ? dadosPaisAno.obitos : 0;
    const letalidade = casos > 0 ? (obitos / casos) * 100 : 0;

    d3.select("#pais-ativo-card").text(nomeCurtoPais(nomeNorm));
    d3.select("#resumo-ano").text(anoSelecionadoAtual);
    d3.select("#resumo-casos").text(casos.toLocaleString());
    d3.select("#resumo-obitos").text(obitos.toLocaleString());
    d3.select("#resumo-letalidade").text(`${letalidade.toFixed(1)}%`);
}

function atualizarDashboard() {
    const dadosAno = obterDadosDoAno();

    if (dadosAno.length === 0) {
        limparGraficos();
        return;
    }

    atualizarKPIs(dadosAno);
    atualizarResumoPaisAtivo();

    renderizarRankingPrincipal();
    renderizarPainelAnalitico();
    renderizarParticipacaoOuObitosQuadrante4();
}

function limparGraficos() {
    d3.select("#mapa-africa").selectAll("*").remove();
    d3.select("#ranking-casos").selectAll("*").remove();
    d3.select("#painel-analitico").selectAll("*").remove();
    d3.select("#participacao-casos").selectAll("*").remove();
}

Promise.all([
    meuDao.carregarDadosEpidemiologicos(),
    d3.json('data/africa.geojson')
]).then(([dadosEbola, dadosGeo]) => {
    dadosGlobaisEbola = dadosEbola;
    dadosGeoGlobais = dadosGeo;

    const anos = d3.rollups(dadosGlobaisEbola, v => d3.sum(v, d => d.casos), d => d.ano)
        .filter(d => d[1] > 0)
        .sort((a, b) => b[0] - a[0]);

    if (anos.length === 0) return;

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
        atualizarDashboard();
    });

    d3.selectAll('input[name="rankingMode"]').on("change", function() {
        modoRankingPrincipal = this.value;
        renderizarRankingPrincipal();
    });

    d3.selectAll('input[name="analiticoMode"]').on("change", function() {
        modoAnalitico = this.value;
        renderizarPainelAnalitico();
    });

    d3.select("#btn-play-anos").on("click", alternarPlayAnos);
    
    d3.select("#btn-reset-filtros").on("click", function() {
        paisSelecionadoAtual = "";
        modoRankingPrincipal = "pais";
        d3.select('input[name="rankingMode"][value="pais"]').property("checked", true);
        atualizarDashboard();
    });

    atualizarDashboard();

}).catch(error => console.error("Erro fatal na inicialização:", error));

function alternarPlayAnos() {
    const anosOrdenados = obterTotaisPorAno().map(d => String(d.ano)).sort((a, b) => Number(a) - Number(b));
    if (!playAtivo) {
        playAtivo = true;
        d3.select("#btn-play-anos").text("⏸ Pausar Animação");
        intervaloPlay = setInterval(() => {
            const indiceAtual = anosOrdenados.indexOf(String(anoSelecionadoAtual));
            const proximoIndice = indiceAtual >= 0 ? (indiceAtual + 1) % anosOrdenados.length : 0;
            anoSelecionadoAtual = anosOrdenados[proximoIndice];
            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
            atualizarDashboard();
        }, 2200);
        return;
    }
    playAtivo = false;
    d3.select("#btn-play-anos").text("▶ Animar Linha do Tempo");
    clearInterval(intervaloPlay);
}

function renderizarMapaAfrica(geoData) {
    const svg = d3.select("#mapa-africa");
    svg.selectAll("*").remove();

    const dadosAno = obterDadosAfricanosDoAno();

    const tradutorBaseParaGeo = {
        "Democratic Republic of the Congo": "DR Congo",
        "Guinea": "Guinea",
        "Guinea-Bissau": "Guinea-Bissau",
        "Sierra Leone": "Sierra Leone",
        "Liberia": "Liberia",
        "Uganda": "Uganda",
        "Nigeria": "Nigeria",
        "Mali": "Mali",
        "Senegal": "Senegal"
    };

    const mapaCasos = new Map();
    dadosAno.forEach(d => {
        const nomeGeo = tradutorBaseParaGeo[d.pais] || d.pais;
        mapaCasos.set(nomeGeo, d.casos);
    });

    const container = document.getElementById("mapa-africa");
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;

    const projection = d3.geoMercator().fitSize([width, height], geoData);
    const path = d3.geoPath().projection(projection);

    const maxCasos = d3.max(dadosAno, d => d.casos) || 1;
    const cor = d3.scaleSequentialLog([1, maxCasos], d3.interpolateReds);

    svg.append("g")
        .selectAll("path")
        .data(geoData.features)
        .enter()
        .append("path")
        .attr("d", path)
        .attr("fill", d => {
            const nomeGeo = d.properties.name;
            const casos = mapaCasos.get(nomeGeo);
            
            if (casos > 0) {
                return cor(casos);
            }
            return "#334155";
        })
        .attr("stroke", "#0f172a")
        .attr("stroke-width", 0.5)
        .style("cursor", d => (mapaCasos.get(d.properties.name) || 0) > 0 ? "pointer" : "default")
        .on("mouseover", function(event, d) {
            const casos = mapaCasos.get(d.properties.name) || 0;
            if (casos > 0) {
                d3.select(this)
                    .attr("fill", "#f87171")
                    .attr("stroke", "#f8fafc")
                    .attr("stroke-width", 1.5);
                tooltip.style("opacity", 1)
                       .html(`<strong>${nomeCurtoPais(d.properties.name)}</strong><br>Casos: ${casos.toLocaleString()}`);
            }
        })
        .on("mousemove", (event) => {
            tooltip.style("left", `${event.pageX + 10}px`).style("top", `${event.pageY - 20}px`);
        })
        .on("mouseout", function(event, d) {
            const casos = mapaCasos.get(d.properties.name) || 0;
            d3.select(this)
                .attr("fill", casos > 0 ? cor(casos) : "#334155")
                .attr("stroke", "#0f172a")
                .attr("stroke-width", 0.5);
            tooltip.style("opacity", 0);
        })
        .on("click", function(event, d) {
            const casos = mapaCasos.get(d.properties.name) || 0;
            if (casos > 0) {
                const chaves = Object.keys(tradutorBaseParaGeo);
                const nomeBase = chaves.find(key => tradutorBaseParaGeo[key] === d.properties.name) || d.properties.name;
                
                paisSelecionadoAtual = nomeBase;
                modoRankingPrincipal = "historicoPais";
                d3.select('input[name="rankingMode"][value="historicoPais"]').property("checked", true);
                
                atualizarDashboard();
            }
        });
}

function renderizarRankingPrincipal() {
    if (modoRankingPrincipal === "pais") {
        d3.select("#titulo-ranking-principal").text(`2. Ranking de Casos por País — ${anoSelecionadoAtual}`);
        const dadosAno = obterDadosDoAno();

        renderizarBarrasHorizontais({
            seletor: "#ranking-casos",
            dados: dadosAno.map(d => ({ label: d.pais, valor: d.casos, casos: d.casos, obitos: d.obitos })),
            tituloTooltip: "Casos",
            formato: d => d.toLocaleString(),
            destacarLabel: paisSelecionadoAtual,
            aoClicar: d => {
                paisSelecionadoAtual = d.label;
                modoRankingPrincipal = "historicoPais";
                d3.select('input[name="rankingMode"][value="historicoPais"]').property("checked", true);
                atualizarDashboard();
            }
        });
        return;
    }

    d3.select("#titulo-ranking-principal").text(`2. Histórico Temporal de Casos — ${nomeCurtoPais(paisSelecionadoAtual)}`);
    const historico = obterHistoricoPais(paisSelecionadoAtual).sort((a,b) => b.casos - a.casos);

    renderizarBarrasHorizontais({
        seletor: "#ranking-casos",
        dados: historico.map(d => ({ label: String(d.ano), valor: d.casos, casos: d.casos, obitos: d.obitos })),
        tituloTooltip: "Casos do país",
        formato: d => d.toLocaleString(),
        destacarLabel: String(anoSelecionadoAtual),
        aoClicar: d => {
            anoSelecionadoAtual = String(d.label);
            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
            atualizarDashboard();
        }
    });
}

function renderizarPainelAnalitico() {
    const cabecalhoMapa = d3.select(".dashboard-grid .card:nth-child(1) h2");

    if (modoAnalitico === "letalidade") {
        if (!paisSelecionadoAtual) {
            d3.select("#titulo-painel-analitico").text("3. Tendência Histórica da Letalidade Global");
        } else {
            d3.select("#titulo-painel-analitico").text(`3. Tendência Histórica da Letalidade — ${nomeCurtoPais(paisSelecionadoAtual)}`);
        }
        if (!cabecalhoMapa.empty()) cabecalhoMapa.text("1. Contexto Espacial — África (Ancoragem Cognitiva)");
        renderizarMapaAfrica(dadosGeoGlobais);
        renderizarLetalidadeHistoricaDoPais("#painel-analitico");
        return;
    }

    if (modoAnalitico === "heatmap") {
        d3.select("#titulo-painel-analitico").text("3. Heatmap Ano × País (Abstração Principal)");
        if (!cabecalhoMapa.empty()) cabecalhoMapa.text("1. Contexto Espacial — África (Ancoragem Cognitiva)");
        renderizarMapaAfrica(dadosGeoGlobais);
        renderizarHeatmapAnoPais("#painel-analitico");
        return;
    }

    d3.select("#titulo-painel-analitico").text("3. Linha do Tempo Global (Métrica Agregada)");
    if (!cabecalhoMapa.empty()) cabecalhoMapa.text("1. Distribuição Espacial (Contexto)");
    renderizarMapaAfrica(dadosGeoGlobais);
    renderizarLinhaTempoGlobal("#painel-analitico");
}

function renderizarLetalidadeHistoricaDoPais(seletor = "#painel-analitico") {
    const svg = d3.select(seletor);
    svg.selectAll("*").remove();

    let dadosLinha = !paisSelecionadoAtual 
        ? obterTotaisPorAno().sort((a, b) => a.ano - b.ano) 
        : obterHistoricoPais(paisSelecionadoAtual).sort((a, b) => a.ano - b.ano);
        
    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;
    
    if (dadosLinha.length === 0) return;

    const margin = { top: 25, right: 40, bottom: 35, left: 50 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    
    const x = d3.scalePoint()
        .domain(dadosLinha.map(d => String(d.ano)))
        .range([0, innerWidth])
        .padding(0.05); 
        
    const y = d3.scaleLinear().domain([0, 100]).range([innerHeight, 0]);

    const line = d3.line()
        .x(d => x(String(d.ano)))
        .y(d => y(d.letalidade))
        .curve(d3.curveMonotoneX);
        
    g.append("g")
        .attr("class", "grid")
        .attr("opacity", 0.1)
        .call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));

    g.append("path")
        .datum(dadosLinha)
        .attr("fill", "none")
        .attr("stroke", "#38bdf8")
        .attr("stroke-width", 3)
        .attr("d", line);

    g.selectAll(".ponto-linha")
        .data(dadosLinha)
        .enter()
        .append("circle")
        .attr("class", "ponto-linha")
        .attr("cx", d => x(String(d.ano)))
        .attr("cy", d => y(d.letalidade))
        .attr("r", d => String(d.ano) === String(anoSelecionadoAtual) ? 7 : 5)
        .attr("fill", d => String(d.ano) === String(anoSelecionadoAtual) ? "#ef4444" : "#1e293b")
        .attr("stroke", d => String(d.ano) === String(anoSelecionadoAtual) ? "#f8fafc" : "#38bdf8")
        .attr("stroke-width", 2)
        .style("cursor", "pointer")
        .on("mouseover", function(event, d) {
            d3.select(this).attr("r", 9);
            tooltip.style("opacity", 1).html(`<strong>Ano: ${d.ano}</strong><br>Letalidade: <strong>${d.letalidade.toFixed(1)}%</strong><br>Casos: ${d.casos.toLocaleString()}<br>Óbitos: ${d.obitos.toLocaleString()}`);
        })
        .on("mousemove", function(event) {
            tooltip.style("left", `${event.pageX + 10}px`).style("top", `${event.pageY - 20}px`);
        })
        .on("mouseleave", function(event, d) {
            d3.select(this).attr("r", String(d.ano) === String(anoSelecionadoAtual) ? 7 : 5);
            tooltip.style("opacity", 0);
        })
        .on("click", function(event, d) {
            anoSelecionadoAtual = String(d.ano);
            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
            atualizarDashboard();
        });

    g.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).tickSize(5))
        .attr("color", "#475569")
        .selectAll("text")
        .style("font-size", "12px")
        .style("font-weight", "600")
        .style("fill", "#94a3b8");

    g.append("g")
        .call(d3.axisLeft(y).ticks(5).tickFormat(d => `${d}%`).tickSize(4).tickPadding(8))
        .attr("color", "#475569")
        .selectAll("text")
        .style("font-size", "12px")
        .style("font-weight", "600")
        .style("fill", "#94a3b8");
}

function renderizarParticipacaoOuObitosQuadrante4() {
    if (!paisSelecionadoAtual) {
        d3.select("#titulo-painel-participacao").text(`4. Severidade Temporal — Ranking de Óbitos no Ano (${anoSelecionadoAtual})`);
        const dadosAno = obterDadosDoAno().sort((a,b) => b.obitos - a.obitos);

        renderizarBarrasHorizontais({
            seletor: "#participacao-casos",
            dados: dadosAno.map(d => ({ label: d.pais, valor: d.obitos, casos: d.casos, obitos: d.obitos })),
            tituloTooltip: "Óbitos",
            formato: d => d.toLocaleString(),
            aoClicar: d => {
                paisSelecionadoAtual = d.label;
                modoRankingPrincipal = "historicoPais";
                d3.select('input[name="rankingMode"][value="historicoPais"]').property("checked", true);
                atualizarDashboard();
            }
        });
        return;
    }

    d3.select("#titulo-painel-participacao").text(`4. Relevância Geopolítica — Participação Global do ${nomeCurtoPais(paisSelecionadoAtual)}`);
    const historico = obterHistoricoPais(paisSelecionadoAtual).sort((a, b) => b.participacao - a.participacao);

    renderizarBarrasHorizontais({
        seletor: "#participacao-casos",
        dados: historico.map(d => ({ label: String(d.ano), valor: d.participacao, casos: d.casos, obitos: d.obitos })),
        tituloTooltip: "Participação mundial",
        formato: d => `${d.toFixed(1)}%`,
        destacarLabel: String(anoSelecionadoAtual),
        dominioMaximo: 100,
        mensagemVazia: "Selecione um país no mapa ou ranking para visualizar o histórico de participação.",
        aoClicar: d => {
            anoSelecionadoAtual = String(d.label);
            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
            atualizarDashboard();
        }
    });
}

function renderizarHeatmapAnoPais(seletor) {
    const svg = d3.select(seletor);
    svg.selectAll("*").remove();

    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;
    const margin = { top: 25, right: 25, bottom: 45, left: 85 }; // IHC FIX: Alinhado margem para 85px para caber "Reino Unido" no Eixo Y

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const anos = [...new Set(dadosGlobaisEbola.map(d => d.ano))].sort((a, b) => a - b);
    const countriesNormalizados = dadosGlobaisEbola.filter(d => d.casos > 0).map(d => normalizarPais(d.pais));
    const paisesOriginais = [...new Set(countriesNormalizados)];
    const paisesCurtosOrdenados = [...new Set(paisesOriginais.map(nomeCurtoPais))].sort();

    const matriz = [];

    paisesOriginais.forEach(pais => {
        anos.forEach(ano => {
            const r = dadosGlobaisEbola.filter(d => normalizarPais(d.pais) === pais && d.ano === ano);
            matriz.push({ 
                paisOriginal: pais, 
                paisCurto: nomeCurtoPais(pais), 
                ano, 
                casos: d3.sum(r, d => d.casos), 
                obitos: d3.sum(r, d => d.obitos) 
            });
        });
    });

    const x = d3.scaleBand().domain(anos.map(String)).range([0, innerWidth]).padding(0.05);
    const y = d3.scaleBand().domain(paisesCurtosOrdenados).range([0, innerHeight]).padding(0.05);
    const cor = d3.scaleSequentialLog().domain([1, 10000]).interpolator(d3.interpolateReds);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    g.selectAll("rect").data(matriz).enter().append("rect")
        .attr("x", d => x(String(d.ano))).attr("y", d => y(d.paisCurto)).attr("width", x.bandwidth()).attr("height", y.bandwidth())
        .attr("fill", d => d.casos > 0 ? cor(d.casos) : "#334155")
        .attr("stroke", d => (String(d.ano) === String(anoSelecionadoAtual) && normalizarPais(d.paisOriginal) === normalizarPais(paisSelecionadoAtual)) ? "#f8fafc" : "#1e293b")
        .attr("stroke-width", d => (String(d.ano) === String(anoSelecionadoAtual) && normalizarPais(d.paisOriginal) === normalizarPais(paisSelecionadoAtual)) ? 2 : 0.5)
        .style("cursor", d => d.casos > 0 ? "pointer" : "default")
        .on("mouseover", function(event, d) {
            const tl = d.casos > 0 ? ((d.obitos / d.casos) * 100).toFixed(1) : "0.0";
            tooltip.style("opacity", 1).html(`<strong>${d.paisCurto}</strong><br>Ano: ${d.ano}<br>Casos: ${d.casos.toLocaleString()}<br>Óbitos: ${d.obitos.toLocaleString()}<br>Letalidade: <strong>${tl}%</strong>`);
        })
        .on("mousemove", function(event) {
            tooltip.style("left", `${event.pageX + 10}px`).style("top", `${event.pageY - 20}px`);
        })
        .on("mouseleave", function() { tooltip.style("opacity", 0); })
        .on("click", function(event, d) {
            if (d.casos > 0) {
                anoSelecionadoAtual = String(d.ano);
                paisSelecionadoAtual = d.paisOriginal; 
                d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
                modoRankingPrincipal = "historicoPais";
                d3.select('input[name="rankingMode"][value="historicoPais"]').property("checked", true);
                atualizarDashboard();
            }
        });

    g.append("g").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x)).attr("color", "#94a3b8");
    g.append("g").call(d3.axisLeft(y)).attr("color", "#94a3b8").selectAll("text").style("font-size", "11.5px");
}

function renderizarLinhaTempoGlobal(seletor) {
    const svg = d3.select(seletor);
    svg.selectAll("*").remove();

    const dados = obterTotaisPorAno().sort((a, b) => a.ano - b.ano);
    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;
    const margin = { top: 25, right: 40, bottom: 45, left: 75 };

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const x = d3.scaleBand().domain(dados.map(d => String(d.ano))).range([0, innerWidth]).padding(0.25);
    const y = d3.scaleLinear().domain([0, d3.max(dados, d => d.casos) || 1]).nice().range([innerHeight, 0]);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    g.selectAll("rect").data(dados).enter().append("rect")
        .attr("x", d => x(String(d.ano))).attr("y", d => y(d.casos)).attr("width", x.bandwidth()).attr("height", d => innerHeight - y(d.casos)).attr("rx", 4)
        .attr("fill", d => String(d.ano) === String(anoSelecionadoAtual) ? "#ef4444" : "#38bdf8")
        .style("cursor", "pointer")
        .on("mouseover", function(event, d) {
            tooltip.style("opacity", 1).html(`<strong>${d.ano}</strong><br>Casos: ${d.casos.toLocaleString()}<br>Óbitos: ${d.obitos.toLocaleString()}<br>Letalidade: <strong>${d.letalidade.toFixed(1)}%</strong>`);
        })
        .on("mousemove", function(event) {
            tooltip.style("left", `${event.pageX + 10}px`).style("top", `${event.pageY - 20}px`);
        })
        .on("mouseleave", function() { tooltip.style("opacity", 0); })
        .on("click", function(event, d) {
            anoSelecionadoAtual = String(d.ano);
            paisSelecionadoAtual = "";
            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
            atualizarDashboard();
        });

    g.append("g").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x)).attr("color", "#94a3b8");
    g.append("g").call(d3.axisLeft(y).ticks(5)).attr("color", "#94a3b8");
}

function renderizarBarrasHorizontais({ seletor, dados, tituloTooltip, formato, destacarLabel = null, dominioMaximo = null, aoClicar = null, mensagemVazia = "Selecione um país no mapa ou ranking para visualizar o histórico de participação." }) {
    const svg = d3.select(seletor);
    svg.selectAll("*").remove();

    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;
    const dadosLimitados = dados.slice(0, 10);

    if (dadosLimitados.length === 0) {
        svg.append("text").attr("x", width / 2).attr("y", height / 2).attr("text-anchor", "middle").attr("fill", "#94a3b8").style("font-size", "12px").style("font-weight", "bold").text(mensagemVazia);
        return;
    }

    const margin = { top: 20, right: 40, bottom: 45, left: 105 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);
    
    const xMax = dominioMaximo ?? (d3.max(dadosLimitados, d => d.valor) || 1);
    const x = d3.scaleLinear()
        .domain([0, xMax * 1.08])
        .range([0, innerWidth]);
    
    const y = d3.scaleBand()
        .domain(dadosLimitados.map(d => nomeCurtoPais(normalizarPais(d.label))))
        .range([0, innerHeight])
        .padding(0.25);

    g.selectAll(".barra-horizontal")
        .data(dadosLimitados)
        .enter()
        .append("rect")
        .attr("class", "barra-horizontal")
        .attr("x", 0) 
        .attr("y", d => y(nomeCurtoPais(normalizarPais(d.label))))
        .attr("width", d => d.valor > 0 ? Math.max(4, x(d.valor)) : 0)
        .attr("height", y.bandwidth())
        .attr("rx", 4)
        .attr("fill", d => normalizarPais(d.label) === normalizarPais(destacarLabel) ? "#ef4444" : "#38bdf8")
        .style("cursor", aoClicar ? "pointer" : "default")
        .on("mouseover", function(event, d) {
            d3.select(this).attr("opacity", 0.85);
            const tl = d.casos > 0 ? ((d.obitos / d.casos) * 100).toFixed(1) : "0.0";
            tooltip.style("opacity", 1).html(`<strong>${nomeCurtoPais(normalizarPais(d.label))}</strong><br>${tituloTooltip}: <strong>${formato(d.valor)}</strong><br>Total Casos: ${d.casos.toLocaleString()}<br>Total Óbitos: ${d.obitos.toLocaleString()}<br>Letalidade: <strong style='color:#f87171'>${tl}%</strong>`);
        })
        .on("mousemove", function(event) {
            tooltip.style("left", `${event.pageX + 10}px`).style("top", `${event.pageY - 20}px`);
        })
        .on("mouseleave", function() { d3.select(this).attr("opacity", 1); tooltip.style("opacity", 0); })
        .on("click", function(event, d) { if (aoClicar) aoClicar(d); });

    g.selectAll(".valor-barra")
        .data(dadosLimitados)
        .enter()
        .append("text")
        .attr("class", "valor-barra")
        .attr("x", d => { 
            const lb = d.valor > 0 ? Math.max(4, x(d.valor)) : 0; 
            return lb > 65 ? lb - 8 : lb + 6; 
        })
        .attr("text-anchor", d => { 
            const lb = d.valor > 0 ? Math.max(4, x(d.valor)) : 0; 
            return lb > 65 ? "end" : "start"; 
        })
        .attr("y", d => y(nomeCurtoPais(normalizarPais(d.label))) + y.bandwidth() / 2 + 4)
        .attr("fill", d => { 
            const lb = d.valor > 0 ? Math.max(4, x(d.valor)) : 0; 
            return lb > 65 ? "#f8fafc" : "#94a3b8"; 
        })
        .style("font-size", "11px")
        .style("font-weight", "bold")
        .text(d => formato(d.valor));

    g.append("g")
        .call(d3.axisLeft(y).tickSize(4).tickPadding(10))
        .attr("color", "#475569") 
        .selectAll("text")
        .style("font-size", "12px")      
        .style("font-weight", "600")     
        .style("fill", "#e2e8f0");       
    
    const quantidadeTicks = xMax > 100 ? 5 : 3;

    const eixoXG = g.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).ticks(quantidadeTicks).tickSize(6).tickPadding(10))
        .attr("color", "#475569");

    eixoXG.selectAll("text")
        .style("font-size", "12px")       
        .style("font-weight", "600")      
        .style("fill", "#94a3b8")         
        .attr("dy", "0.5em");             

    eixoXG.selectAll("line")
        .style("stroke", "#475569")
        .style("stroke-width", "1px");
}