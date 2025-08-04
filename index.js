require('dotenv').config();
const express = require('express');
const multer = require('multer');
const fetch = require('node-fetch');
const cors = require('cors');

const app = express();
const upload = multer();

app.use(cors());

// Log todas as requisições
app.use((req, res, next) => {
  console.log(`📥 ${req.method} ${req.url}`);
  next();
});

app.post('/api/proxy-upload', upload.array('file'), async (req, res) => {
  const { token, username, repo, spaceId } = req.body;
  const files = req.files;

  console.log('📥 Recebido upload:', {
    username,
    repo,
    spaceId,
    hasFiles: !!files,
    fileCount: files?.length,
    fileNames: files?.map(f => f.originalname),
    fileSizes: files?.map(f => f.size)
  });

  if (!token || !username || !repo || !files || files.length === 0) {
    return res.status(400).json({ error: 'token, username, repo e files são obrigatórios' });
  }

  try {
    const results = [];
    const operations = [];
    
    // Processar todos os arquivos usando apenas a API de commit
    for (const file of files) {
      try {
        console.log(`🔄 Processando: ${file.originalname} (${file.size} bytes)`);
        
        // Validar tamanho do arquivo (limite de 100MB)
        if (file.size > 100 * 1024 * 1024) {
          results.push({
            file: file.originalname,
            success: false,
            error: 'Arquivo muito grande (>100MB)'
          });
          continue;
        }

        // Validar nome do arquivo
        if (!file.originalname || file.originalname.trim() === '') {
          results.push({
            file: file.originalname || 'arquivo-sem-nome',
            success: false,
            error: 'Nome de arquivo inválido'
          });
          continue;
        }

        // Converter arquivo para base64 (funciona para texto e binários)
        const content = file.buffer.toString('base64');
        
        // Criar operação
        const operation = {
          operation: 'addOrUpdate',
          path: file.originalname.trim(),
          content: content,
          encoding: 'base64'
        };
        
        operations.push(operation);
        
        results.push({
          file: file.originalname,
          success: true,
          method: 'commit',
          type: 'base64',
          size: file.size,
          contentLength: content.length
        });
        
        console.log(`✅ Processado: ${file.originalname} (base64, ${content.length} chars)`);
        
      } catch (error) {
        console.error(`❌ Erro ao processar ${file.originalname}:`, error);
        results.push({
          file: file.originalname,
          success: false,
          error: error.message
        });
      }
    }
    
    if (operations.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'Nenhum arquivo válido para upload',
        results
      });
    }
    

    
    let commitUrl, requestBody;

    if (spaceId) {
      // Para Spaces - usar formato correto da API de Spaces
      commitUrl = `https://huggingface.co/api/spaces/${spaceId}/commit/main`;
      
      // Formato correto para Spaces: usar files com encoding base64
      const spaceFiles = operations.map(op => ({
        path: op.path,
        content: op.content, // Já está em base64
        encoding: 'base64'
      }));
      
      requestBody = {
        files: spaceFiles,
        summary: `Upload de ${operations.length} arquivo(s) via Visual Editor`
      };
      

    } else {
      // Para Repositories
      const repoId = `${username}/${repo}`;
      
      // Tentar criar repositório se não existir
      try {
      const createResponse = await fetch('https://huggingface.co/api/repos/create', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'User-Agent': 'HF-Visual-Editor/1.0',
        },
        body: JSON.stringify({
          name: repo,
          private: false
        })
      });

        if (createResponse.status === 200) {
          console.log('✅ Repositório criado com sucesso');
        } else if (createResponse.status === 409) {
          console.log('ℹ️ Repositório já existe');
        } else {
        const createError = await createResponse.text();
          console.log(`⚠️ Erro ao criar repositório (${createResponse.status}): ${createError}`);
      }
      } catch (createErr) {
        console.log(`⚠️ Erro na criação do repositório: ${createErr.message}`);
      }
      
      commitUrl = `https://huggingface.co/api/repos/${repoId}/commit/main`;
      requestBody = {
        operations: operations,
        commit_title: `Upload de ${operations.length} arquivo(s) via Visual Editor`,
        commit_message: `Adicionados/atualizados os seguintes arquivos:\n${operations.map(op => `- ${op.path}`).join('\n')}`
      };
    }



    const response = await fetch(commitUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
        'User-Agent': 'HF-Visual-Editor/1.0',
      },
      body: JSON.stringify(requestBody)
    });

    const responseText = await response.text();

    if (response.ok) {
      const successCount = results.filter(r => r.success).length;
      
      // Tentar parsear resposta como JSON para mais detalhes
      let parsedResponse = null;
      try {
        parsedResponse = JSON.parse(responseText);
      } catch (e) {
        // Resposta não é JSON válido
      }
      
      return res.json({ 
        success: true, 
        message: `${successCount}/${files.length} arquivos enviados com sucesso`,
        results,
        response: responseText,
        parsedResponse,
        target: spaceId ? 'space' : 'repository',
        commitUrl,
        operationsCount: operations.length
      });
    } else {

      
      return res.status(response.status).json({ 
        success: false, 
        message: `Erro no commit (${response.status}): ${responseText}`,
        status: response.status,
        results,
        target: spaceId ? 'space' : 'repository',
        commitUrl,
        operationsCount: operations.length
      });
    }

  } catch (err) {
    return res.status(500).json({ 
      success: false, 
      message: `Erro interno: ${err.message}`,
      target: spaceId ? 'space' : 'repository',
      stack: err.stack
    });
  }
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`🚀 HF Proxy rodando na porta ${PORT}`);
  console.log(`📡 Endpoint: http://localhost:${PORT}/api/proxy-upload`);
}); 