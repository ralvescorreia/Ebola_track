import { loadDb } from './config.js';

export class DAO {
    constructor() {
        this.db = null;
        this.conn = null;
    }

    async inicializar() {
        if (this.conn) return;

        this.db = await loadDb();
        this.conn = await this.db.connect();
    }

    async carregarDadosEpidemiologicos() {
        await this.inicializar();

        const urlDoCsv = `${window.location.origin}/data/ebola_mock.csv`;

        const resultado = await this.conn.query(`
            SELECT
                CAST(Year AS INT) AS ano_epi,
                Country AS pais,
                CAST(Cases AS INT) AS casos_confirmados,
                CAST(Deaths AS INT) AS obitos_confirmados
            FROM read_csv('${urlDoCsv}',
                delim=';',
                header=true,
                quote='"',
                escape='"',
                ignore_errors=true,
                null_padding=true
            )
            WHERE Year IS NOT NULL
              AND Country IS NOT NULL
        `);

        return resultado.toArray().map(r => {
            const linha = r.toJSON();

            return {
                ano: Number(linha.ano_epi),
                pais: String(linha.pais).trim(),
                casos: Number(linha.casos_confirmados) || 0,
                obitos: Number(linha.obitos_confirmados) || 0
            };
        });
    }
}