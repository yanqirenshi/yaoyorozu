import React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import S from '@mui/material/Typography';

import { FrameWbsNode as Frame } from '@yanqirenshi/ihub.core';

// WBS のデータに ID はあるが、ページのコンポーネント(ファイル)が無い場合に表示する。
// FrameWbsNode を使い、ノードの見出しと配下の WBS を表示する。
export default function NotFoundWbsNodeComponent (props) {
    return (
        <Frame>
          <Container maxWidth="lg" sx={{pt:5}}>
            <Box>
              <S>Not Found WBS Node Component.</S>
            </Box>
          </Container>
        </Frame>
    );
}
