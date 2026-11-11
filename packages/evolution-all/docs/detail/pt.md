## O que faz

Transforma uma sessão comum do Harness em uma sessão que se aprimora sozinha: o agente lembra o que aprendeu, mantém uma biblioteca de skills, revisa o próprio trabalho, funde skills duplicadas e as cura com o tempo. Os dados ficam na sua home do DSH, e as chamadas de modelo vão para o provedor que você configurou.

## O que vem incluído

- Memória: a ferramenta `memory` exposta ao modelo, apoiada em um armazenamento local de memória em camadas.
- Skills: a ferramenta `skill_manage`, um catálogo que o agente pode carregar e um workbench com o histórico das skills.
- Revisão e fusão: revisão em segundo plano, redação de skills em duas rodadas e uma aprovação de fusão que você pode ativar.
- Curadoria e manutenção: verificações do ciclo de vida, varreduras de desvio e uma visão de saúde somente leitura que vem desativada.
- Comandos: `/evolution pending`, `curator`, `maintain` e `doctor` funcionam em qualquer sessão, com ou sem painel.

## Onde configurar

Cada parâmetro editável pertence ao componente que é dono dele, e o painel mostra o valor em vigor, o padrão com que ele vem e se você o substituiu. A maioria das mudanças é imediata e alguns ajustes de implantação exigem reinício; os parâmetros que você não mexe continuam no padrão.

## Observações

As escritas normais de memória e de skills são aplicadas automaticamente, a menos que você ative a aprovação de gravação: com ela ligada, cada escrita deixa uma entrada pendente para você aprovar ou rejeitar primeiro. A visão de saúde vem desativada. A fusão de skills tem um ajuste de aprovação próprio, separado da aprovação de gravação, e guarda um comprovante que permite desfazê-la.
