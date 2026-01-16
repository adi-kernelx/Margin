FROM public.ecr.aws/lambda/python:3.10

# Copy dependency list
COPY requirements.txt .

# Install Python dependencies into Lambda task root
RUN pip install --no-cache-dir -r requirements.txt -t ${LAMBDA_TASK_ROOT}

# Copy Lambda handler code
COPY lambda_handler.py ${LAMBDA_TASK_ROOT}

# Set Lambda handler
CMD ["lambda_handler.handler"]
