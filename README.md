# Flor de Página — Biblioteca Literária

Um gerenciador de livros feito apenas com HTML, CSS e JavaScript. Não precisa de login, servidor próprio ou banco de dados remoto.

## Recursos

- Visual girly em rosa/lilás, responsivo, com modo claro e escuro.
- No celular, menu lateral em gaveta: deslize da borda esquerda para a direita para abrir e para a esquerda para fechar; também há botão de menu e toque fora para fechar.
- Cadastro, edição, visualização e exclusão de livros.
- **133 títulos pré-carregados automaticamente na primeira abertura.**
- Autores e capas extraídos dos metadados/capas dos arquivos AZW3 fornecidos; nenhum texto dos livros foi usado para essa operação.
- Capas padrão guardadas localmente em `covers/`, para não depender de uma API externa.
- Título, autor, sinopse e fichas curtas de personagens principais quando foi possível confirmar os nomes e seus papéis.
- Status de leitura, favoritos, nota de 0 a 5, comentários/resenha e anotações pessoais.
- Pesquisa em títulos, autores, sinopses, gêneros, personagens, comentários e anotações.
- Filtros por gênero e status, ordenação e indicadores da biblioteca.
- Salvamento local automático, importação/exportação JSON.
- Nos navegadores compatíveis, opção de vincular um arquivo JSON para sincronização automática.

## Como abrir

1. Extraia a pasta do projeto.
2. Abra `index.html` no navegador. Os 133 títulos aparecem automaticamente na primeira abertura; não é necessário importar `biblioteca-inicial.json`.
3. Se preferir trabalhar pelo VS Code, pode usar a extensão **Live Server** (`http://127.0.0.1:5500`). O vínculo direto de arquivos JSON depende do suporte do navegador e geralmente funciona no Chrome/Edge para desktop em contexto seguro.

## Arquivos principais

- `index.html`: estrutura da interface.
- `styles.css`: cores, layout, modo escuro e responsividade.
- `app.js`: lógica da biblioteca.
- `default-books.js`: dados iniciais para que o site funcione mesmo ao abrir diretamente como `file://`.
- `biblioteca-inicial.json`: lista dos 133 livros com autores, sinopses, personagens disponíveis e caminhos das capas.
- `biblioteca.json`: arquivo vazio de exemplo para vincular/sincronizar.
- `covers/`: imagens locais das capas predefinidas.

## Como os dados são guardados

- **Sem vincular arquivo:** livros e alterações ficam no `localStorage` do navegador. Isso não cria automaticamente um arquivo `.json` no computador.
- **Backup JSON:** clique em **Exportar JSON**. O backup inclui títulos, autores, personagens, gêneros, notas, comentários e imagens carregadas por você. Para as capas padrão, o campo `cover` aponta para `covers/`; mantenha essa pasta junto do site para que os caminhos relativos continuem funcionando.
- **Arquivo JSON sincronizado:** selecione **Vincular JSON** e escolha um JSON existente. Depois de autorizar a leitura/gravação, as alterações são gravadas nele. Caso o navegador não tenha esse recurso, use a exportação manual.
- **Não substitui sua biblioteca existente:** os dados padrão só são inseridos quando o site ainda não tem uma biblioteca salva. Se você já usou uma versão anterior e deseja reimportar os títulos iniciais, use **Importar JSON** e selecione `biblioteca-inicial.json`.

## Pesquisa das fichas bibliográficas

Os 133 títulos têm uma sinopse curta em português, reescrita em linguagem própria e sem buscar reproduzir textos editoriais extensos. **132 livros têm personagens principais identificados e descritos**. A ficha de *Hunter*, atribuída a Widjane Albuquerque, registra a limitação da pesquisa porque não foi localizada uma sinopse pública confiável que permitisse confirmar com segurança essa edição; por isso a lista de personagens permanece vazia, em vez de arriscar dados de outro livro homônimo.

As fichas foram preparadas consultando fontes públicas como páginas de editoras e autores, catálogos de livrarias, referências bibliográficas e páginas de leitores. Resultados públicos associados ao BookTok podem ajudar na identificação, mas o TikTok restringe o acesso automatizado a parte do conteúdo; portanto, o projeto não afirma que cada vídeo ou comentário da plataforma foi lido diretamente. Quando há diferença entre edições ou títulos semelhantes, priorize a edição correspondente à sua cópia.

Gêneros, notas, comentários e anotações pessoais continuam disponíveis para vocês preencherem conforme preferirem. As sinopses e personagens são informativos e podem ser editados dentro da própria biblioteca.

## Formato de dados

O JSON usa um objeto `books` com as fichas. O campo `cover` pode ser uma imagem em base64 (`data:image/jpeg;base64,...`) ou um caminho local relativo, como `covers/start-....jpg`.

## Observações

- Evite limpar os dados do navegador antes de exportar um backup.
- O site não envia as fichas para serviços externos. O Google Fonts é usado apenas para tipografia, com fontes de sistema como alternativa se estiver offline.

Link: https://samuelcsalema.github.io/Biblioteca-Kindle/