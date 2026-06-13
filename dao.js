/**
 * =================================================================================
 * UNIVERSIDADE FEDERAL FLUMINENSE (UFF) - MESTRADO EM CIÊNCIA DA COMPUTAÇÃO
 * DISCIPLINA: DESIGN DE SISTEMAS DE VISUALIZAÇÃO INTERATIVOS
 * PROFESSOR: MARCOS LAGE
 * REFACTORING DE ENGENHARIA DE SOFTWARE - PADRÃO DATA ACCESS OBJECT (DAO)
 * =================================================================================
 */

import { loadDb } from './config.js';

export class DAO {
    constructor() {
        this.db = null;
        this.conn = null;
        // Definimos o nome da tabela física que vai existir na memória do navegador
        this.tableName = 'ebola_table'; 
    }

    // Inicializa a engine WebAssembly do DuckDB e abre uma conexão ativa
    async inicializar() {
        if (this.conn) return;
        this.db = await loadDb();
        this.conn = await this.db.connect();
    }

    /**
     * ---------------------------------------------------------------------------------
     * DATA ABSTRACTION (CONVERSÃO DE DADOS BRUTOS) [cite: 27]
     * ---------------------------------------------------------------------------------
     * Lê o arquivo CSV bruto e transforma em uma estrutura adequada (tabela relacional rápida e tipada) para as visões coordenadas[cite: 27].
     */
    async carregarDadosEpidemiologicos() {
        await this.inicializar();

        const urlDoCsv = `${window.location.origin}/data/ebola_mock.csv`;

        // 1. O DuckDB lê o CSV remotamente e já cria a tabela com os tipos corretos (INT)
        // Usamos COALESCE e CAST como transformações nos dados brutos para garantir integridade e evitar erros matemáticos[cite: 10].
        await this.conn.query(`
            CREATE TABLE ${this.tableName} AS
            SELECT
                CAST(Year AS INT) AS ano,
                TRIM(Country) AS pais,
                CAST(COALESCE(Cases, 0) AS INT) AS casos,
                CAST(COALESCE(Deaths, 0) AS INT) AS obitos
            FROM read_csv('${urlDoCsv}',
                delim=';',
                header=true,
                quote='"',
                escape='"',
                ignore_errors=true,
                null_padding=true
            )
            WHERE Year IS NOT NULL AND Country IS NOT NULL;
        `);

        // 2. Retorna todos os dados limpos logo na primeira carga, provendo a estrutura base ao sistema
        const resultadoBruto = await this.conn.query(`SELECT * FROM ${this.tableName}`);
        return resultadoBruto.toArray().map(r => r.toJSON());
    }

    // Método genérico ("túnel") abstrato para que o app.js possa rodar qualquer SQL de forma livre no DuckDB [cite: 18]
    async executarQuery(sql) {
        if (!this.db || !this.conn) {
            throw new Error('Banco de dados não está pronto.');
        }
        // Executa a string SQL e converte o resultado do padrão Arrow para JSON nativo do JS exigido pelo D3 [cite: 18, 20]
        const chunk = await this.conn.query(sql);
        return chunk.toArray().map(row => row.toJSON());
    }
}