/**
 * =================================================================================
 * UNIVERSIDADE FEDERAL FLUMINENSE (UFF) - MESTRADO EM CIÊNCIA DA COMPUTAÇÃO
 * DISCIPLINA: DESIGN DE SISTEMAS DE VISUALIZAÇÃO INTERATIVOS
 * PROFESSOR: MARCOS LAGE
 * IMPLEMENTAÇÃO REFATORADA: VISÕES INTERATIVAS COORDENADAS E INTERAÇÃO REATIVA
 * =================================================================================
 */

import { DAO } from './dao.js';

const meuDao = new DAO();

// Cache e coleções locais estruturais para suporte
let dadosGlobaisEbola = [];
let dadosGeoGlobais = null;

/**
 * ---------------------------------------------------------------------------------
 * A. STATE MANAGEMENT (GERENCIAMENTO DE ESTADOS DA INTERAÇÃO) [cite: 20]
 * ---------------------------------------------------------------------------------
 * Controla os alvos reativos que sincronizam as múltiplas visões encadeadas (Linked Views)[cite: 6].
 */

// Armazena o país que o usuário clicou (seja no mapa ou no ranking). Vazio significa visão global.
let paisSelecionadoAtual = ""; 
// Armazena o ano atual que está sendo visualizado em todos os gráficos.
let anoSelecionadoAtual = "";
// Controla qual aba do ranking está activa (ex: 'pais' para mostrar todos os países no ano selecionado, ou 'historicoPais').
let modoRankingPrincipal = "pais"; 
// Controla qual gráfico será exibido no 3º quadrante (Letalidade, Heatmap ou Linha do Tempo).
let modoAnalitico = "letalidade";
// Flag booleana para saber se o botão de "Play" (evolução temporal automática) está rodando.
let playAtivo = false;
// Variável para guardar o ID do timer do setInterval, permitindo pausar a animação depois.
let intervaloPlay = null;

// Detalhes sob demanda (Details-on-demand Tooltip) acoplado para redução de carga cognitiva [cite: 6, 14]
// Cria um elemento div invisível no corpo do HTML que servirá como o "balãozinho" de informações ao passar o mouse.
const tooltip = d3.select('body')
    .append('div')
    .attr('class', 'tooltip');

/**
 * ---------------------------------------------------------------------------------
 * B. DATA TRANSFORMATIONS & SYNCHRONIZATION (ESTABILIDADE STRINGS / TRADUÇÕES) [cite: 10, 27]
 * ---------------------------------------------------------------------------------
 */

// Função que recebe um nome de país e retorna um padrão único em inglês.
// Isso garante que variações no nome do país (no CSV ou no mapa GeoJSON) não quebrem as junções dos dados.
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

// Recebe o nome normalizado e devolve uma versão curta em português para exibir na tela (ficar bonito nos rótulos).
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

// Lê o arquivo GeoJSON (mapa) e cria uma lista (Set) contendo apenas os nomes dos países africanos.
async function obterPaisesNoMapaAfrica() {
    if (!dadosGeoGlobais) return new Set();
    return new Set(
        dadosGeoGlobais.features.map(feature =>
            normalizarPais(feature.properties.name || feature.properties.ADMIN)
        )
    );
}

/**
 * ---------------------------------------------------------------------------------
 * C. DATA ANALYSIS LAYER (QUERIES DE AGREGAÇÃO VIA DUCKDB ENGINE) [cite: 10, 27]
 * ---------------------------------------------------------------------------------
 * Processamento e filtros relacionais em lote executados diretamente por SQL no DuckDB[cite: 18].
 */

// Faz uma consulta SQL no DuckDB para pegar todos os casos e óbitos filtrando apenas pelo ano que está ativo na tela.
async function obterDadosDoAno() {
    const sql = `
        SELECT pais, ano, CAST(casos AS INT) AS casos, CAST(obitos AS INT) AS obitos
        FROM ebola_table
        WHERE ano = ${Number(anoSelecionadoAtual)} AND casos > 0
        ORDER BY casos DESC;
    `;
    const res = await meuDao.executarQuery(sql);
    // Retorna a lista já com os nomes dos países padronizados.
    return res.map(d => ({ ...d, pais: normalizarPais(d.pais) }));
}

// Pega os dados do ano (acima) e filtra mantendo APENAS os países que pertencem ao continente Africano.
async function obterDadosAfricanosDoAno() {
    const paisesAfrica = await obterPaisesNoMapaAfrica();
    const dadosAno = await obterDadosDoAno();
    return dadosAno.filter(d => paisesAfrica.has(d.pais));
}

// Faz uma consulta SQL agregando (GROUP BY) a soma total de casos e mortes globais.
// Correção IHC/Arrow: Aplicado CAST(SUM(...) AS INT) para evitar o retorno de HUGEINT/Arrays fragmentados [359,0,0,0].
async function obterTotaisPorAno() {
    const sql = `
        SELECT 
            CAST(ano AS INT) AS ano,
            CAST(SUM(casos) AS INT) AS total_casos,
            CAST(SUM(obitos) AS INT) AS total_obitos
        FROM ebola_table
        GROUP BY ano
        HAVING total_casos > 0
        ORDER BY ano ASC;
    `;
    const res = await meuDao.executarQuery(sql);
    // Formata o resultado do SQL calculando a letalidade matemática para uso nos gráficos.
    return res.map(d => ({
        ano: d.ano,
        label: String(d.ano),
        casos: d.total_casos,
        obitos: d.total_obitos,
        casosPorObito: d.total_obitos > 0 ? d.total_casos / d.total_obitos : 0,
        letalidade: d.total_casos > 0 ? (d.total_obitos / d.total_casos) * 100 : 0
    }));
}

// Busca a evolução histórica (linha do tempo de casos e mortes) apenas para o país que o usuário selecionou.
// Correção IHC/Arrow: Aplicado CAST(SUM(...) AS INT) para sanar o bug de formatação no toLocaleString.
async function obterHistoricoPais(pais) {
    const nomeNorm = normalizarPais(pais);
    // Pega o volume total do mundo primeiro, para poder calcular qual a "fatia" (participação) esse país representou.
    const totaisGlobais = await obterTotaisPorAno();
    const mapaGlobais = new Map(totaisGlobais.map(d => [d.ano, d.casos]));

    // Query SQL filtrando os dados (WHERE) especificamente pelo nome do país selecionado.
    const sql = `
        SELECT 
            CAST(ano AS INT) AS ano,
            CAST(SUM(casos) AS INT) AS total_casos,
            CAST(SUM(obitos) AS INT) AS total_obitos
        FROM ebola_table
        WHERE pais = '${nomeNorm}'
        GROUP BY ano
        HAVING total_casos > 0
        ORDER BY ano DESC;
    `;
    const res = await meuDao.executarQuery(sql);
    
    // Constrói os objetos de retorno calculando a letalidade local e a participação frente ao global.
    return res.map(d => {
        const globalCasos = mapaGlobais.get(d.ano) || 0;
        const participacao = globalCasos > 0 ? (d.total_casos / globalCasos) * 100 : 0;

        return {
            ano: d.ano,
            label: String(d.ano),
            casos: d.total_casos,
            obitos: d.total_obitos,
            letalidade: d.total_casos > 0 ? (d.total_obitos / d.total_casos) * 100 : 0,
            casosPorObito: d.total_obitos > 0 ? d.total_casos / d.total_obitos : 0,
            participacao
        };
    });
}

/**
 * ---------------------------------------------------------------------------------
 * D. INTERACTION SYNCHRONIZATION (COORDENAÇÃO E RENDERIZAÇÃO DO DOM) [cite: 6, 20]
 * ---------------------------------------------------------------------------------
 */

// Atualiza a barra superior da tela com os indicadores em texto (KPIs).
async function atualizarKPIs(dadosAno) {
    // Soma todos os casos e mortes do array passado para gerar o valor global do ano.
    const totalCasos = d3.sum(dadosAno, d => d.casos);
    const totalObitos = d3.sum(dadosAno, d => d.obitos);
    const letalidade = totalCasos > 0 ? (totalObitos / totalCasos) * 100 : 0;

    // Lista fixa (Set) determinando quais países formam o cluster africano da doença.
    const paisesAfricanosBase = new Set([
        "Democratic Republic of the Congo", "Guinea", "Guinea-Bissau", 
        "Equatorial Guinea", "Sierra Leone", "Liberia", "Uganda", 
        "Nigeria", "Mali", "Senegal"
    ]);

    // Conta quantos países africanos registraram pelo menos 1 caso.
    const paisesAfricanosAfetados = dadosAno.filter(d => paisesAfricanosBase.has(d.pais)).length;
    // Conta quantos casos "vazaram" para fora da África (EUA, Espanha, etc).
    const casesImported = d3.sum(dadosAno.filter(d => !paisesAfricanosBase.has(d.pais)), d => d.casos);

    // Seleciona os spans do HTML e injeta os números formatados com pontos de milhar.
    d3.select("#kpi-casos").text(totalCasos.toLocaleString());
    d3.select("#kpi-obitos").text(totalObitos.toLocaleString());
    d3.select("#kpi-letalidade").text(`${letalidade.toFixed(1)}%`);
    d3.select("#kpi-paises").text(paisesAfricanosAfetados.toLocaleString());
    d3.select("#kpi-importados").text(casesImported.toLocaleString());
}

// Atualiza o painel na barra lateral direita exibindo o nome e o resumo numérico do país clicado.
async function atualizarResumoPaisAtivo() {
    // Se nenhum país estiver clicado, exibe os totais globais do ano.
    if (!paisSelecionadoAtual) {
        d3.select("#pais-ativo-card").text("Todos (Global)");
        d3.select("#resumo-ano").text(anoSelecionadoAtual);
        
        const dadosAno = await obterDadosDoAno();
        const totalCasos = d3.sum(dadosAno, d => d.casos);
        const totalObitos = d3.sum(dadosAno, d => d.obitos);
        const letalidade = totalCasos > 0 ? (totalObitos / totalCasos) * 100 : 0;

        d3.select("#resumo-casos").text(totalCasos.toLocaleString());
        d3.select("#resumo-obitos").text(totalObitos.toLocaleString());
        d3.select("#resumo-letalidade").text(`${letalidade.toFixed(1)}%`);
        return;
    }

    // Se houver um país clicado, busca os dados apenas daquele país naquele ano.
    const nomeNorm = normalizarPais(paisSelecionadoAtual);
    const dadosAno = await obterDadosDoAno();
    const dadosPaisAno = dadosAno.find(d => normalizarPais(d.pais) === nomeNorm);
    
    // Se não houver dados, o país teve zero casos, então retorna 0.
    const casos = dadosPaisAno ? dadosPaisAno.casos : 0;
    const obitos = dadosPaisAno ? dadosPaisAno.obitos : 0;
    const letalidade = casos > 0 ? (obitos / casos) * 100 : 0;

    // Atualiza a caixinha com o nome em português e os números.
    d3.select("#pais-ativo-card").text(nomeCurtoPais(nomeNorm));
    d3.select("#resumo-ano").text(anoSelecionadoAtual);
    d3.select("#resumo-casos").text(casos.toLocaleString());
    d3.select("#resumo-obitos").text(obitos.toLocaleString());
    d3.select("#resumo-letalidade").text(`${letalidade.toFixed(1)}%`);
}

// Função orquestradora mestre: É chamada sempre que o usuário interagir com qualquer elemento que mude o cenário.
async function atualizarDashboard() {
    const dadosAno = await obterDadosDoAno();

    // Se o ano não tiver dados no banco, limpa a tela para não exibir gráfico quebrado.
    if (dadosAno.length === 0) {
        limparGraficos();
        return;
    }

    // Dispara a atualização sequencial e assíncrona de cada componente (KPIs, barra lateral, Ranking e Gráficos de linha).
    await atualizarKPIs(dadosAno);
    await atualizarResumoPaisAtivo();

    await renderizarRankingPrincipal();
    await renderizarPainelAnalitico();
    await renderizarParticipacaoOuObitosQuadrante4();
}

// Remove os elementos visuais internos dos gráficos (SVG), mas mantém a tag SVG mãe intacta.
function limparGraficos() {
    d3.select("#mapa-africa").selectAll("g").remove();
    d3.select("#ranking-casos").selectAll("*").remove();
    d3.select("#painel-analitico").selectAll("*").remove();
    d3.select("#participacao-casos").selectAll("*").remove();
}

/**
 * ---------------------------------------------------------------------------------
 * E. APPLICATION INITIALIZATION (CICLO DE CARGA ASSÍNCRONA)
 * ---------------------------------------------------------------------------------
 */

// O Promise.all assegura que a tela só comece a ser montada após o DuckDB engolir o CSV e o GeoJSON do mapa ser baixado[cite: 17, 18].
Promise.all([
    meuDao.carregarDadosEpidemiologicos(),
    d3.json('data/africa.geojson')
]).then(async ([dadosEbola, dadosGeo]) => {
    // Salva o mapa e os dados brutos nas variáveis globais cache.
    dadosGlobaisEbola = dadosEbola;
    dadosGeoGlobais = dadosGeo;

    // Pede ao banco uma lista contendo apenas os anos únicos (DISTINCT) que existem no CSV.
    const sqlAnos = `SELECT DISTINCT ano FROM ebola_table ORDER BY ano DESC;`;
    const anosValidos = await meuDao.executarQuery(sqlAnos);

    if (anosValidos.length === 0) return;

    // Define o ano mais recente disponível como o estado inicial padrão da tela.
    anoSelecionadoAtual = String(anosValidos[0].ano);

    // Constrói dinamicamente a caixa suspensa (select/dropdown) usando o padrão de manipulação do D3[cite: 20].
    const seletor = d3.select("#container-legenda-html")
        .html("")
        .append("select")
        .attr("id", "seletor-ano-painel");

    // Correção IHC/Arrow: CAST(SUM(casos) AS INT) aplicado para sanar de vez o bug visual do "0,0,0,0".
    const sqlMenu = `SELECT ano, CAST(SUM(casos) AS INT) AS soma_casos FROM ebola_table GROUP BY ano ORDER BY ano DESC;`;
    const opcoesMenu = await meuDao.executarQuery(sqlMenu);

    // Vincula (.data) a lista de anos com a criação de novas tags <option> para o HTML.
    seletor.selectAll("option")
        .data(opcoesMenu)
        .enter()
        .append("option")
        .attr("value", d => d.ano)
        .text(d => `Ano ${d.ano} (${d.soma_casos.toLocaleString()} casos)`);

    // Deixa o seletor com o valor do ano selecionado.
    seletor.property("value", anoSelecionadoAtual);

    // Se o usuário clicar em outro ano no Dropdown, captura o evento, atualiza o estado e redesenha a tela.
    seletor.on("change", function(event) {
        anoSelecionadoAtual = event.target.value;
        atualizarDashboard();
    });

    // Escutadores para os botões de rádio que decidem o modo do Ranking.
    d3.selectAll('input[name="rankingMode"]').on("change", function() {
        modoRankingPrincipal = this.value;
        renderizarRankingPrincipal();
    });

    // Escutadores para os botões de rádio que decidem qual gráfico aparece no Painel Analítico.
    d3.selectAll('input[name="analiticoMode"]').on("change", function() {
        modoAnalitico = this.value;
        renderizarPainelAnalitico();
    });

    // Vincula o botão de "Evolução Temporal" à função que dispara a animação (loop temporal).
    d3.select("#btn-play-anos").on("click", alternarPlayAnos);
    
    // Botão de "Limpar país selecionado" apaga o estado do país ativo e devolve o sistema para a visão "Todos (Global)".
    d3.select("#btn-reset-filtros").on("click", function() {
        paisSelecionadoAtual = "";
        modoRankingPrincipal = "pais";
        d3.select('input[name="rankingMode"][value="pais"]').property("checked", true);
        atualizarDashboard();
    });

    // Carrega e renderiza o dashboard pela primeira vez.
    await atualizarDashboard();

}).catch(error => console.error("Erro fatal na inicialização do sistema:", error));

// Lógica de loop automático (Slider de Animação).
async function alternarPlayAnos() {
    const totais = await obterTotaisPorAno();
    // Monta um array com todos os anos ordenados cronologicamente do menor para o maior.
    const anosOrdenados = totais.map(d => String(d.ano)).sort((a, b) => Number(a) - Number(b));
    
    // Se a animação não estiver tocando...
    if (!playAtivo) {
        playAtivo = true; // Muda o estado
        d3.select("#btn-play-anos").text("⏸ Pausar Animação"); // Muda o texto do botão
        
        // Dispara um relógio (setInterval) que roda a cada 2.2 segundos (2200 milissegundos).
        intervaloPlay = setInterval(async () => {
            // Descobre em qual posição da lista o ano atual se encontra.
            const indiceAtual = anosOrdenados.indexOf(String(anoSelecionadoAtual));
            // Calcula o próximo ano (Avança o array e volta para o 0 quando chegar no fim, usando o módulo %).
            const proximoIndice = indiceAtual >= 0 ? (indiceAtual + 1) % anosOrdenados.length : 0;
            anoSelecionadoAtual = anosOrdenados[proximoIndice]; // Atualiza o estado
            
            // Reflete a mudança no Dropdown do HTML.
            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
            
            // Redesenha a tela com os dados do ano novo, criando a sensação de filme/animação.
            await atualizarDashboard();
        }, 2200);
        return;
    }
    // Se o usuário clicar de novo, limpa o temporizador e pára a animação.
    playAtivo = false;
    d3.select("#btn-play-anos").text("▶ Animar Linha do Tempo");
    clearInterval(intervaloPlay);
}

/**
 * ---------------------------------------------------------------------------------
 * F. RENDERING IDIOMS & SELECTIONS (.JOIN CYCLES) [cite: 14, 20]
 * ---------------------------------------------------------------------------------
 */

// Cria e renderiza a representação geográfica cartográfica (Mapa da África).
async function renderizarMapaAfrica(geoData) {
    const svg = d3.select("#mapa-africa");
    const dadosAno = await obterDadosAfricanosDoAno();

    // Dicionário usado para fazer a "ponte" entre o nome que está no CSV e o nome que a propriedade name da malha GeoJSON usa.
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

    // Cria um mapa-chave (Dicionário de Pesquisa rápida) pareando o Nome Geográfico do país com a quantidade de Casos.
    const mapaCasos = new Map();
    dadosAno.forEach(d => {
        const nomeGeo = tradutorBaseParaGeo[d.pais] || d.pais;
        mapaCasos.set(nomeGeo, d.casos);
    });

    // Puxa as dimensões reais de altura e largura que a div do mapa tem na tela naquele momento.
    const container = document.getElementById("mapa-africa");
    const width = container.clientWidth || 600;
    const height = container.clientHeight || 400;

    // Constrói a projeção matemática de Mercator dizendo ao D3 para escalonar as linhas do GeoJSON pra caber perfeitamente no container (.fitSize).
    const projection = d3.geoMercator().fitSize([width, height], geoData);
    // Cria a ferramenta capaz de transformar os pontos de GPS em cordenadas poligonais (strings d) pra desenhar caminhos.
    const path = d3.geoPath().projection(projection);

    const maxCasos = d3.max(dadosAno, d => d.casos) || 1;
    // Cria uma escala de cores vermelhas, usando modelo logarítmico para grandes variações numéricas (Diferenciar um país com 5 casos de um com 50.000)[cite: 13].
    const cor = d3.scaleSequentialLog([1, maxCasos], d3.interpolateReds);

    // Padrão de vinculação estruturada (Data Join) sem limpeza destrutiva do container principal
    // Garante que o agrupador <g> não vai ser apagado e recriado à toa[cite: 20].
    const mGroup = svg.selectAll('#mapGroup')
        .data([0])
        .join('g')
        .attr('id', 'mapGroup');

    const paths = mGroup.selectAll('path')
        .data(geoData.features); // Relaciona as fronteiras dos países contidas no geoData ao mapa visual[cite: 20].

    // O .join() garante que o D3 não remova os caminhos. Ele apenas os "atualiza", garantindo a fluidez da interação[cite: 20].
    paths.join('path')
        .attr("d", path) // Aplica os caminhos cartográficos (as bordas geográficas)
        .attr("stroke", "#0f172a") // Cor da linha da borda do país
        .attr("stroke-width", 0.5) // Espessura da borda
        // O cursor vira a "mãozinha" (pointer) apenas se houverem casos relatados lá, indicando clicabilidade.
        .style("cursor", d => (mapaCasos.get(d.properties.name) || 0) > 0 ? "pointer" : "default")
        // Calcula a cor de preenchimento. País com caso vira vermelho, país sem caso vira cinza escuro escuro (#334155).
        .attr("fill", d => {
            const nomeGeo = d.properties.name;
            const casos = mapaCasos.get(nomeGeo);
            return casos > 0 ? cor(casos) : "#334155";
        })
        // EVENTOS DE INTERAÇÃO (HOVER) DO MAPA
        .on("mouseover", function(event, d) {
            const casos = mapaCasos.get(d.properties.name) || 0;
            // Se houver casos, o país fica "rosado" (highlight) com uma borda grossa e branca para focar a atenção do usuário[cite: 14].
            if (casos > 0) {
                d3.select(this)
                    .attr("fill", "#f87171")
                    .attr("stroke", "#f8fafc")
                    .attr("stroke-width", 1.5);
                // Injeta as informações do país ativo formatadas diretamente dentro do balão (Tooltip HTML) que seguirá o ponteiro do mouse[cite: 6].
                tooltip.style("opacity", 1)
                       .html(`<strong>${nomeCurtoPais(d.properties.name)}</strong><br>Casos: ${casos.toLocaleString()}`);
            }
        })
        .on("mousemove", (event) => {
            // Posiciona a caixa do tooltip alguns pixels abaixo e à direita de onde o ponteiro do mouse está na tela real do usuário.
            tooltip.style("left", `${event.pageX + 10}px`).style("top", `${event.pageY - 20}px`);
        })
        .on("mouseout", function(event, d) {
            const casos = mapaCasos.get(d.properties.name) || 0;
            // Quando o mouse sai, devolve a cor, a espessura da linha ao seu estado padrão e esconde o balãozinho (opacity 0).
            d3.select(this)
                .attr("fill", casos > 0 ? cor(casos) : "#334155")
                .attr("stroke", "#0f172a")
                .attr("stroke-width", 0.5);
            tooltip.style("opacity", 0);
        })
        .on("click", async function(event, d) {
            const casos = mapaCasos.get(d.properties.name) || 0;
            if (casos > 0) {
                // Ao clicar em um país vermelho, descobre seu equivalente no CSV pelo Geo.
                const chaves = Object.keys(tradutorBaseParaGeo);
                const nomeBase = chaves.find(key => tradutorBaseParaGeo[key] === d.properties.name) || d.properties.name;
                
                // Muta os estados informando que a tela inteira agora é sobre ESSE país (filtragem espacial)[cite: 6].
                paisSelecionadoAtual = nomeBase;
                modoRankingPrincipal = "historicoPais";
                // Interação coordenada: força fisicamente o painel esquerdo a mudar sua bolinha do botão "radio" dinamicamente[cite: 11].
                d3.select('input[name="rankingMode"][value="historicoPais"]').property("checked", true);
                
                // Redesenha toda a matriz de dados na nova lente do país clicado.
                await atualizarDashboard();
            }
        });
}

// Renderiza a parte do ranking no topo direito (Muda os tipos de barra se for Global vs Histórico individual de país)
async function renderizarRankingPrincipal() {
    // Se o radiobox mostrar "Países no ano"
    if (modoRankingPrincipal === "pais") {
        // Renomeia o título da janela dinamicamente para garantir feedback visual direto ao usuário.
        d3.select("#titulo-ranking-principal").text(`2. Ranking de Casos por País — ${anoSelecionadoAtual}`);
        const dadosAno = await obterDadosDoAno();

        // Aciona o gerador universal passando os dados formatados do Q2
        renderizarBarrasHorizontais({
            seletor: "#ranking-casos",
            // Cria um array anônimo transformando "pais" e "casos" na terminologia genérica "label" e "valor".
            dados: dadosAno.map(d => ({ label: d.pais, valor: d.casos, casos: d.casos, obitos: d.obitos })),
            tituloTooltip: "Casos",
            formato: d => d.toLocaleString(),
            destacarLabel: paisSelecionadoAtual,
            aoClicar: async d => {
                paisSelecionadoAtual = d.label;
                modoRankingPrincipal = "historicoPais";
                d3.select('input[name="rankingMode"][value="historicoPais"]').property("checked", true);
                await atualizarDashboard();
            }
        });
        return;
    }

    // Se o rádio exibir o modo "Histórico do país" (Ou seja, o usuário clicou em algum gráfico antes)
    d3.select("#titulo-ranking-principal").text(`2. Histórico Temporal de Casos — ${nomeCurtoPais(paisSelecionadoAtual)}`);
    const hData = await obterHistoricoPais(paisSelecionadoAtual);
    const historico = hData.sort((a,b) => b.casos - a.casos);

    renderizarBarrasHorizontais({
        seletor: "#ranking-casos",
        // Neste caso a label genérica recebe o ano (temporal)[cite: 6].
        dados: historico.map(d => ({ label: String(d.ano), valor: d.casos, casos: d.casos, obitos: d.obitos })),
        tituloTooltip: "Casos do país",
        formato: d => d.toLocaleString(),
        destacarLabel: String(anoSelecionadoAtual),
        aoClicar: async d => {
            // Clicar numa barra desse gráfico troca de ano (Viajante no tempo) em vez de país[cite: 6].
            anoSelecionadoAtual = String(d.label);
            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
            await atualizarDashboard();
        }
    });
}

// Verifica qual botão de rádio do Q3 (quadrante 3 analítico) está marcado e redesenha a div principal correspondente[cite: 14].
async function renderizarPainelAnalitico() {
    // Altera o título do Mapa da África, informando ao usuário que o mapa agora se torna mero contexto visual ancorado.
    const cabecalhoMapa = d3.select(".dashboard-grid .card:nth-child(1) h2");

    if (modoAnalitico === "letalidade") {
        if (!paisSelecionadoAtual) {
            d3.select("#titulo-painel-analitico").text("3. Tendência Histórica da Letalidade Global");
        } else {
            d3.select("#titulo-painel-analitico").text(`3. Tendência Histórica da Letalidade — ${nomeCurtoPais(paisSelecionadoAtual)}`);
        }
        if (!cabecalhoMapa.empty()) cabecalhoMapa.text("1. Contexto Espacial — África (Ancoragem Cognitiva)");
        await renderizarMapaAfrica(dadosGeoGlobais);
        await renderizarLetalidadeHistoricaDoPais("#painel-analitico");
        return;
    }

    if (modoAnalitico === "heatmap") {
        d3.select("#titulo-painel-analitico").text("3. Heatmap Ano × País (Abstração Principal)");
        if (!cabecalhoMapa.empty()) cabecalhoMapa.text("1. Contexto Espacial — África (Ancoragem Cognitiva)");
        await renderizarMapaAfrica(dadosGeoGlobais);
        await renderizarHeatmapAnoPais("#painel-analitico");
        return;
    }

    d3.select("#titulo-painel-analitico").text("3. Linha do Tempo Global (Métrica Agregada)");
    if (!cabecalhoMapa.empty()) cabecalhoMapa.text("1. Distribuição Espacial (Contexto)");
    await renderizarMapaAfrica(dadosGeoGlobais);
    await renderizarLinhaTempoGlobal("#painel-analitico");
}

// Cria o clássico Gráfico de Evolução (Line Chart) ligando os pontos de cálculo da Letalidade ano após ano.
async function renderizarLetalidadeHistoricaDoPais(seletor = "#painel-analitico") {
    const svg = d3.select(seletor);
    svg.selectAll("*").remove();

    // Reutiliza a função de histórico do país, ou assume a função global de agregação caso nenhum país tenha foco no momento.
    let dadosLinha = !paisSelecionadoAtual 
        ? await obterTotaisPorAno() 
        : await obterHistoricoPais(paisSelecionadoAtual);
    
    // Organiza por ano (do menor pro maior) para a linha traçar um "progresso" temporal correto da esquerda pra direita[cite: 6].
    dadosLinha.sort((a, b) => a.ano - b.ano);
        
    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;
    
    if (dadosLinha.length === 0) return;

    // Constrói uma margem estática para evitar de cortar os eixos no fim da borda física do SVG.
    const margin = { top: 25, right: 40, bottom: 35, left: 50 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    
    // x = Escala de ponto do D3 (Ideal para categorizar números discretos como se fossem string: ex '2014', '2015') no eixo horizontal[cite: 13].
    const x = d3.scalePoint()
        .domain(dadosLinha.map(d => String(d.ano)))
        .range([0, innerWidth])
        .padding(0.05); 
        
    // y = Escala linear do D3 pra mapear a letalidade como porcentagem. Vai fisicamente do limite da tela (innerHeight, que fica em baixo) até o topo (0)[cite: 13].
    const y = d3.scaleLinear().domain([0, 100]).range([innerHeight, 0]);

    // Fábrica de linhas do D3: Ensina ele como conectar cada ponto "x" (ano) ao seu correspondente "y" (letalidade).
    const line = d3.line()
        .x(d => x(String(d.ano)))
        .y(d => y(d.letalidade))
        // Curve suaviza a linha usando um spline não agressivo, esteticamente removendo cantos retos afiados.
        .curve(d3.curveMonotoneX);
        
    // Cria as linhas de grade horizontais cinzas do fundo da tela (Eixo Y esticado até os confins horizontais).
    g.append("g")
        .attr("class", "grid")
        .attr("opacity", 0.1)
        .call(d3.axisLeft(y).ticks(5).tickSize(-innerWidth).tickFormat(""));

    // Adiciona o "path" visualmente na tela, chamando a linha baseada em datum (pois é um único elemento gráfico cobrindo todos os dados)[cite: 20].
    g.append("path")
        .datum(dadosLinha)
        .attr("fill", "none")
        .attr("stroke", "#38bdf8")
        .attr("stroke-width", 3)
        .attr("d", line);

    // Agora gera os círculos em cima da linha, marcando efetivamente cada ponto do trajeto com a tag .ponto-linha[cite: 20].
    g.selectAll(".ponto-linha")
        .data(dadosLinha)
        .enter()
        .append("circle")
        .attr("class", "ponto-linha")
        .attr("cx", d => x(String(d.ano)))
        .attr("cy", d => y(d.letalidade))
        // A bolinha que representa o ano atual selecionado aparece fisicamente um pouquinho maior (7px ao invés de 5px)[cite: 14].
        .attr("r", d => String(d.ano) === String(anoSelecionadoAtual) ? 7 : 5)
        .attr("fill", d => String(d.ano) === String(anoSelecionadoAtual) ? "#ef4444" : "#1e293b")
        .attr("stroke", d => String(d.ano) === String(anoSelecionadoAtual) ? "#f8fafc" : "#38bdf8")
        .attr("stroke-width", 2)
        .style("cursor", "pointer")
        .on("mouseover", function(event, d) {
            d3.select(this).attr("r", 9); // Incha a bolinha caso o mouse repouse sobre ela[cite: 14].
            tooltip.style("opacity", 1).html(`<strong>Ano: ${d.ano}</strong><br>Letalidade: <strong>${d.letalidade.toFixed(1)}%</strong><br>Casos: ${d.casos.toLocaleString()}<br>Óbitos: ${d.obitos.toLocaleString()}`);
        })
        .on("mousemove", function(event) {
            tooltip.style("left", `${event.pageX + 10}px`).style("top", `${event.pageY - 20}px`);
        })
        .on("mouseleave", function(event, d) {
            d3.select(this).attr("r", String(d.ano) === String(anoSelecionadoAtual) ? 7 : 5);
            tooltip.style("opacity", 0);
        })
        .on("click", async function(event, d) {
            anoSelecionadoAtual = String(d.ano);
            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
            await atualizarDashboard();
        });

    // Anexa formalmente a legenda numérica do Eixo X no fundo inferior do gráfico[cite: 20].
    g.append("g")
        .attr("transform", `translate(0,${innerHeight})`)
        .call(d3.axisBottom(x).tickSize(5))
        .attr("color", "#475569")
        .selectAll("text")
        .style("font-size", "12px")
        .style("font-weight", "600")
        .style("fill", "#94a3b8");

    // Anexa formalmente o formato numérico esquerdo do Eixo Y (% letalidade)[cite: 20].
    g.append("g")
        .call(d3.axisLeft(y).ticks(5).tickFormat(d => `${d}%`).tickSize(4).tickPadding(8))
        .attr("color", "#475569")
        .selectAll("text")
        .style("font-size", "12px")
        .style("font-weight", "600")
        .style("fill", "#94a3b8");
}

// Cuida da lógica dupla do quadrante de relevância 4
async function renderizarParticipacaoOuObitosQuadrante4() {
    // Se visão for "Global" exibe as mortes no decorrer do ano corrente.
    if (!paisSelecionadoAtual) {
        d3.select("#titulo-painel-participacao").text(`4. Severidade Temporal — Ranking de Óbitos no Ano (${anoSelecionadoAtual})`);
        const dAno = await obterDadosDoAno();
        const dadosAno = dAno.sort((a,b) => b.obitos - a.obitos);

        renderizarBarrasHorizontais({
            seletor: "#participacao-casos",
            dados: dadosAno.map(d => ({ label: d.pais, valor: d.obitos, casos: d.casos, obitos: d.obitos })),
            tituloTooltip: "Óbitos",
            formato: d => d.toLocaleString(),
            aoClicar: async d => {
                paisSelecionadoAtual = d.label;
                modoRankingPrincipal = "historicoPais";
                d3.select('input[name="rankingMode"][value="historicoPais"]').property("checked", true);
                await atualizarDashboard();
            }
        });
        return;
    }

    // Se houver foco nacional, mostra quantos % do bolo pandêmico aquele país produziu com o passar do tempo.
    d3.select("#titulo-painel-participacao").text(`4. Relevância Geopolítica — Participação Global do ${nomeCurtoPais(paisSelecionadoAtual)}`);
    const hData = await obterHistoricoPais(paisSelecionadoAtual);
    const historico = hData.sort((a, b) => b.participacao - a.participacao);

    renderizarBarrasHorizontais({
        seletor: "#participacao-casos",
        dados: historico.map(d => ({ label: String(d.ano), valor: d.participacao, casos: d.casos, obitos: d.obitos })),
        tituloTooltip: "Participação mundial",
        formato: d => `${d.toFixed(1)}%`,
        destacarLabel: String(anoSelecionadoAtual),
        dominioMaximo: 100, // Trava a escala (O eixo X máximo nunca passa de 100%)[cite: 13].
        mensagemVazia: "Selecione um país no mapa ou ranking para visualizar o histórico de participação.",
        aoClicar: async d => {
            anoSelecionadoAtual = String(d.label);
            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
            await atualizarDashboard();
        }
    });
}

// Cria o Mapa de Calor Cruzado de Dupla Densidade (País no Y x Anos no X)
async function renderizarHeatmapAnoPais(seletor) {
    const svg = d3.select(seletor);
    svg.selectAll("*").remove();

    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;
    const margin = { top: 25, right: 25, bottom: 45, left: 85 };

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    // Faz um Select total agrupando cada país por cada ano.
    // Correção IHC/Arrow: Injetado CAST(SUM(...) AS INT) nas agregações do heatmap.
    const sqlHeat = `SELECT CAST(ano AS INT) AS ano, pais, CAST(SUM(casos) AS INT) AS t_casos, CAST(SUM(obitos) AS INT) AS t_obitos FROM ebola_table GROUP BY ano, pais;`;
    const rawMatriz = await meuDao.executarQuery(sqlHeat);

    // Filtra e prepara as listas fixas dos eixos.
    const anos = [...new Set(rawMatriz.map(d => d.ano))].sort((a, b) => a - b);
    const countriesNormalizados = rawMatriz.filter(d => d.t_casos > 0).map(d => normalizarPais(d.pais));
    const paisesOriginais = [...new Set(countriesNormalizados)];
    const paisesCurtosOrdenados = [...new Set(paisesOriginais.map(nomeCurtoPais))].sort();

    // A matriz armazena as células coloridas com suas devidas coordenadas X e Y relativas.
    const matriz = [];

    // Lógica dupla: Pra cada pais, faz uma varredura em cada ano e vincula as linhas correspondentes criando a rede de quadrados cartesianos.
    paisesOriginais.forEach(pais => {
        anos.forEach(ano => {
            const r = rawMatriz.filter(d => normalizarPais(d.pais) === pais && d.ano === ano);
            matriz.push({ 
                paisOriginal: pais, 
                paisCurto: nomeCurtoPais(pais), 
                ano, 
                casos: d3.sum(r, d => d.t_casos), 
                obitos: d3.sum(r, d => d.t_obitos) 
            });
        });
    });

    // Ambas são escalas "Band" (Faixa), alocando divisões em grade proporcionais em relação ao tamanho total do quadrante analítico livre[cite: 13].
    const x = d3.scaleBand().domain(anos.map(String)).range([0, innerWidth]).padding(0.05);
    const y = d3.scaleBand().domain(paisesCurtosOrdenados).range([0, innerHeight]).padding(0.05);
    const cor = d3.scaleSequentialLog().domain([1, 10000]).interpolator(d3.interpolateReds);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    
    // Anexa um quadrado para cada elo da matriz populacional[cite: 20].
    g.selectAll("rect").data(matriz).enter().append("rect")
        .attr("x", d => x(String(d.ano))).attr("y", d => y(d.paisCurto)).attr("width", x.bandwidth()).attr("height", y.bandwidth())
        .attr("fill", d => d.casos > 0 ? cor(d.casos) : "#334155")
        // O Quadrado em que o ano E o país coincidem com a seleção atual na tela, fica piscando em branco (Stroke)[cite: 14].
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
        // Selecionar um quadrado de dados atualiza ao mesmo tempo as duas variáveis de estado do aplicativo e sincroniza tudo[cite: 11].
        .on("click", async function(event, d) {
            if (d.casos > 0) {
                anoSelecionadoAtual = String(d.ano);
                paisSelecionadoAtual = d.paisOriginal; 
                d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
                modoRankingPrincipal = "historicoPais";
                d3.select('input[name="rankingMode"][value="historicoPais"]').property("checked", true);
                await atualizarDashboard();
            }
        });

    g.append("g").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x)).attr("color", "#94a3b8");
    g.append("g").call(d3.axisLeft(y)).attr("color", "#94a3b8").selectAll("text").style("font-size", "11.5px");
}

// Cria um diagrama simples de colunas em pé relatando a somatória global com o transcorrer temporal[cite: 6].
async function renderizarLinhaTempoGlobal(seletor) {
    const svg = d3.select(seletor);
    svg.selectAll("*").remove();

    const totais = await obterTotaisPorAno();
    const dados = totais.sort((a, b) => a.ano - b.ano);
    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;
    const margin = { top: 25, right: 40, bottom: 45, left: 75 };

    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const x = d3.scaleBand().domain(dados.map(d => String(d.ano))).range([0, innerWidth]).padding(0.25);
    const y = d3.scaleLinear().domain([0, d3.max(dados, d => d.casos) || 1]).nice().range([innerHeight, 0]);

    const g = svg.append("g").attr("transform", `translate(${margin.left},${margin.top})`);
    g.selectAll("rect").data(dados).enter().append("rect")
        // O valor y precisa se inverter fisicamente pq o gráfico SVG do D3 é desenhado sempre de cima (0) para baixo (height)[cite: 13, 20].
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
        .on("click", async function(event, d) {
            anoSelecionadoAtual = String(d.ano);
            paisSelecionadoAtual = ""; // Limpa país atual caso o foco fosse num país e volta o modo pro Global
            d3.select("#seletor-ano-painel").property("value", anoSelecionadoAtual);
            await atualizarDashboard();
        });

    g.append("g").attr("transform", `translate(0,${innerHeight})`).call(d3.axisBottom(x)).attr("color", "#94a3b8");
    g.append("g").call(d3.axisLeft(y).ticks(5)).attr("color", "#94a3b8");
}

// Método universal reutilizável (Factory genérica) que empacota a inteligência pra formatar as barras do ranking em diferentes orientações[cite: 14].
function renderizarBarrasHorizontais({ seletor, dados, tituloTooltip, formato, destacarLabel = null, dominioMaximo = null, aoClicar = null, mensagemVazia = "Selecione um país no mapa ou ranking para visualizar o histórico de participação." }) {
    const svg = d3.select(seletor);
    svg.selectAll("*").remove();

    const width = svg.node().getBoundingClientRect().width;
    const height = svg.node().getBoundingClientRect().height;
    // Pega as 10 maiores ou as 10 recentes sem quebrar o limite da tela.
    const dadosLimitados = dados.slice(0, 10);

    // Se o país tiver taxa vazia de dados (Sem mortes), não renderiza.
    if (dadosLimitados.length === 0) {
        svg.append("text").attr("x", width / 2).attr("y", height / 2).attr("text-anchor", "middle").attr("fill", "#94a3b8").style("font-size", "12px").style("font-weight", "bold").text(mensagemVazia);
        return;
    }

    const margin = { top: 20, right: 40, bottom: 45, left: 105 };
    const innerWidth = width - margin.left - margin.right;
    const innerHeight = height - margin.top - margin.bottom;

    const g = svg.append("g")
        .attr("transform", `translate(${margin.left},${margin.top})`);
    
    // Define qual será a régua. Pode ser o maior elemento (ex: Maior país com casos do Array * 1.08 para dar margem) Ou fixa pra limite max de porcentagem 100%[cite: 13].
    const xMax = dominioMaximo ?? (d3.max(dadosLimitados, d => d.valor) || 1);
    const x = d3.scaleLinear()
        .domain([0, xMax * 1.08])
        .range([0, innerWidth]);
    
    // A faixa Y da direita pra esquerda abriga a terminologia (Os labels string) traduzidas do Q2 e Q4[cite: 13].
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

    // Anexa as strings flutuantes (Texto branco que mostra os números precisos) flutuando do lado direito ou de dentro do corpo do rect de cada barra horiziontal[cite: 20].
    g.selectAll(".valor-barra")
        .data(dadosLimitados)
        .enter()
        .append("text")
        .attr("class", "valor-barra")
        .attr("x", d => { 
            const lb = d.valor > 0 ? Math.max(4, x(d.valor)) : 0; 
            return lb > 65 ? lb - 8 : lb + 6; // Empurra a barra de texto caso seja muito estreita a fim de evitar sobreposições (overlapping/occlusion error).
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
    
    // O eixo base X diminui a quantidade de ticks se os números forem exacerbadamente largos
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