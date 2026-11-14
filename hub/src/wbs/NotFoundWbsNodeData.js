import React from 'react';
import Box from '@mui/material/Box';
import Container from '@mui/material/Container';
import S from '@mui/material/Typography';

import { Frame } from '@yanqirenshi/ihub.core';

export default function NotFoundWbsNodeData (props) {
    return (
        <Frame>
          <Container maxWidth="lg" sx={{pt:5}}>
            <Box>
              <S>Not Found WBS Node.</S>
            </Box>
          </Container>
        </Frame>
    );
}
